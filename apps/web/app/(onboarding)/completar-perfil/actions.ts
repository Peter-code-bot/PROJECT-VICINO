"use server";

import { revalidatePath } from "@/lib/revalidate-session";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export type CaminoOnboarding = "explorar" | "vender";
export type PasoOnboarding = "perfil" | "intereses" | "ubicacion";

interface GuardarPasoInput {
  camino?: CaminoOnboarding;
  paso?: PasoOnboarding;
  nombre?: string;
  bio?: string;
  foto?: string;
  intereses?: string[];
}

/**
 * Guarda UN paso del onboarding sin tocar lo que guardaron los anteriores.
 *
 * Va por RPC y no por un update normal porque `authenticated` solo tiene
 * UPDATE sobre (foto, fcm_token) en profiles — los privilegios de esa tabla se
 * dan columna por columna. Nombre, bio e intereses son inalcanzables desde el
 * cliente por cualquier otra via.
 *
 * El COALESCE vive dentro de la funcion (20260905100000): omitir un campo
 * significa «no lo toques», nunca «borralo». Es lo que permite que el paso 3
 * llame sin mandar lo del paso 2.
 */
export async function guardarPasoOnboarding(input: GuardarPasoInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  // La misma cuota que usa el resto de escrituras del repo (chat, publicar,
  // favoritos). Esto es una server action, o sea un endpoint HTTP alcanzable
  // sin pasar por la pantalla, y escribe en profiles a traves de un
  // SECURITY DEFINER. Quedarse fuera del patron no tenia ninguna razon: era el
  // unico endpoint de escritura del onboarding sin freno.
  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  // Los topes se comprueban AQUI y no solo con el maxLength de los inputs. Un
  // `maxLength` es una comodidad del navegador, no una defensa: esto es un
  // endpoint HTTP y se puede llamar sin pasar por la pantalla. Sin esto, `bio`
  // es una columna de texto sin limite y cualquiera con sesion puede escribir
  // megabytes en su perfil.
  //
  // Y se comprueba el TIPO antes que la longitud. Nacieron como
  // `input.nombre.length > 60`, que da por hecho que llega una cadena solo
  // porque lo dice el tipo de TypeScript. El tipo no viaja por la red: un null
  // o un numero enviados a mano hacian que `.length` reventara con un
  // TypeError, o sea un 500 en vez del mensaje que toca.
  //
  // El resto (camino, paso, 1-5 intereses, que el slug exista) vive dentro del
  // RPC, que es el sitio correcto porque no se puede rodear.
  const texto = (v: unknown, max: number) =>
    v === undefined || (typeof v === "string" && v.length <= max);

  if (!texto(input.nombre, 60)) return { error: "Ese nombre no es válido." };
  if (!texto(input.bio, 160)) return { error: "Esa descripción no es válida." };
  if (input.foto !== undefined && typeof input.foto !== "string") {
    return { error: "Esa foto no es válida." };
  }

  // Los intereses se validan aqui ADEMAS de en el RPC. La funcion comprueba que
  // cada slug exista en el catalogo con un NOT EXISTS, y un elemento NULL pasa
  // ese filtro —NULL nunca casa, asi que el NOT EXISTS no lo atrapa— y muere
  // mas abajo contra el CHECK de la columna. El mensaje que llegaba entonces
  // era el generico de «revisa tu conexion», que culpa a la red de un dato
  // malformado.
  if (input.intereses !== undefined) {
    const lista = input.intereses;
    if (
      !Array.isArray(lista) ||
      lista.length < 1 ||
      lista.length > 5 ||
      lista.some((s) => typeof s !== "string" || s.length === 0 || s.length > 80)
    ) {
      return { error: "Elige entre 1 y 5 intereses." };
    }
  }

  const { error } = await supabase.rpc("guardar_paso_onboarding", {
    p_camino: input.camino,
    p_paso: input.paso,
    p_nombre: input.nombre,
    p_bio: input.bio,
    p_foto: input.foto,
    p_intereses: input.intereses,
  });

  if (error) {
    // El detalle tecnico se queda en el servidor. Postgres nombra la columna o
    // la policy que rechazo en `details`, y perderlo obliga a diagnosticar a
    // ciegas — ya paso con el 42501 de modo_precio.
    Sentry.captureException(error, {
      tags: { action: "guardar_paso_onboarding" },
      contexts: { supabase: { code: error.code, details: error.details } },
    });

    // 22023 son las validaciones de la propia funcion (camino o paso
    // invalidos, mas de 5 intereses, slug inexistente). Ese mensaje SI es para
    // la persona: lo escribimos nosotros y dice algo accionable.
    if (error.code === "22023") return { error: error.message };
    if (error.code === "P0002") {
      return {
        error:
          "Tu perfil aún no está listo. Espera unos segundos e intenta de nuevo; si persiste, contáctanos.",
      };
    }
    return { error: "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo." };
  }

  await revalidatePath("/completar-perfil");
  return { success: true };
}
