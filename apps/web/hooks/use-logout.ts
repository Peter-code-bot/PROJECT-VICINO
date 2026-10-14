"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import * as Sentry from "@sentry/nextjs";
import { cuentaMasReciente, cuentasDormidas, quitarCuenta, vaciarBoveda } from "@/lib/cuentas/boveda";
import { desmarcarCambioEnCurso, marcarCambioEnCurso } from "@/lib/cuentas/cambio-en-curso";
import { aplicarCuenta } from "@/lib/cuentas/cambio";
import { puertoCambioReal, reportarCuentas } from "@/lib/cuentas/puertos";
import { revocarSesion } from "@/lib/cuentas/sesion-aislada";
import { DESTINO_TRAS_AGREGAR } from "@/lib/cuentas/agregando-cuenta";

export interface OpcionesLogout {
  /** Revoca tambien las cuentas dormidas y vacia la boveda: el telefono queda limpio. */
  todas?: boolean;
}

/**
 * Implementacion unica de cierre de sesion en cliente.
 *
 * auth-js sale de _signOut() devolviendo { error } ANTES de _removeSession()
 * cuando el fallo no es 401/403/404: red caida, timeout, 5xx o 429 de GoTrue
 * llegan como AuthRetryableFetchError, que no es AuthApiError y por eso no
 * entra en la lista de excepciones que permiten limpiar igual. Descartar ese
 * error y navegar a /login deja la sesion viva en el dispositivo mientras la
 * interfaz ya dice que cerro: en un telefono compartido, el siguiente en
 * usarlo entra como el usuario anterior.
 *
 * Por eso solo navegamos cuando signOut() confirma exito. Si falla, devolvemos
 * el mensaje para que quien llama lo muestre y el usuario pueda reintentar.
 *
 * Consciente de cuentas (decision D3): si hay otras cuentas guardadas en el
 * telefono, al cerrar la activa se pasa a la mas reciente en vez de ir a
 * /login, como hace Instagram. signOut() sigue siendo GLOBAL a proposito (es lo
 * que este boton ha hecho siempre y lo que se espera de el en un telefono
 * compartido); lo local es "Quitar" en la hoja de cuentas.
 */
export function useLogout() {
  const router = useRouter();

  return async (opciones?: OpcionesLogout): Promise<{ error?: string }> => {
    const supabase = createClient();
    const todas = opciones?.todas === true;

    // Soltar el token de push ANTES de cerrar sesion: despues ya no hay permiso
    // para escribir en el perfil.
    //
    // El token de FCM es por dispositivo, no por persona. Si no se limpia, el
    // perfil del que se va sigue apuntando a ESTE telefono, y cuando otra
    // persona entra, las notificaciones del anterior aterrizan en su pantalla.
    // Ya hay dos cuentas compartiendo token en produccion, asi que no es
    // hipotetico.
    //
    // Es best-effort a proposito: que falle no puede impedir cerrar sesion. Pero
    // se registra, que es justo lo que faltaba en todo lo demas que aparecio hoy.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error: tokenError } = await supabase
        .from("profiles")
        .update({ fcm_token: null })
        .eq("id", user.id);
      if (tokenError) {
        Sentry.captureException(tokenError, {
          tags: { hook: "useLogout", step: "clear_fcm_token" },
          level: "warning",
        });
      }
    }

    if (todas) {
      // Las dormidas se revocan una a una ANTES de perder la activa. Un fallo de
      // red en una no detiene el resto: el objetivo de quien pulsa esto es que el
      // telefono quede limpio, y eso se cumple vaciando la boveda. La sesion que
      // no se pudo revocar NO caduca sola (sesiones indefinidas en prod), por
      // eso se reporta con el userId: se puede revocar a mano desde el panel.
      for (const dormida of cuentasDormidas(user?.id)) {
        const resultado = await revocarSesion(dormida);
        if (resultado.ok) {
          quitarCuenta(dormida.userId);
        } else {
          Sentry.captureException(resultado.error, {
            level: "warning",
            tags: { hook: "useLogout", step: "revocar_dormida" },
            extra: { userId: dormida.userId },
          });
        }
      }
    }

    const siguiente = todas ? null : cuentaMasReciente(user?.id);
    // La marca va ANTES de signOut: el SIGNED_OUT que emite llegaria a
    // session-data-provider, que sin marca haria una navegacion dura a /login
    // antes de que pudieramos pasar a la siguiente cuenta.
    if (siguiente) marcarCambioEnCurso(siguiente.userId);

    const { error } = await supabase.auth.signOut();
    if (error) {
      if (siguiente) desmarcarCambioEnCurso();
      Sentry.captureException(error, {
        tags: { hook: "useLogout" },
        contexts: { auth: { name: error.name, status: error.status ?? null } },
      });
      return { error: "No se pudo cerrar tu sesión. Revisa tu conexión e inténtalo de nuevo." };
    }

    if (user) quitarCuenta(user.id);
    if (todas) vaciarBoveda();

    if (!siguiente) {
      router.push("/login");
      router.refresh();
      return {};
    }

    const resultado = await aplicarCuenta(siguiente, puertoCambioReal());
    if (!resultado.ok) {
      desmarcarCambioEnCurso();
      if (resultado.motivo === "red") reportarCuentas("logout_siguiente", new Error(resultado.motivo), "warning");
      // Ya no hay sesion: el aviso va por toast porque quien llamo se desmonta.
      toast.error(resultado.mensaje);
      router.push("/login");
      router.refresh();
      return {};
    }
    toast.success(`Ahora estás en ${resultado.nombre}`);
    // Navegacion blanda, como en la hoja de cuentas (carrera de la cookie en iOS).
    router.refresh();
    setTimeout(() => router.replace(DESTINO_TRAS_AGREGAR), 50);
    return {};
  };
}
