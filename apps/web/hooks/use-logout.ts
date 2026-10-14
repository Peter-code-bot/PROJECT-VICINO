"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import * as Sentry from "@sentry/nextjs";
import { conTope } from "@/lib/auth/con-tope";
import { cuentaMasReciente, cuentasDormidas, guardarCuenta, quitarCuenta, vaciarBoveda } from "@/lib/cuentas/boveda";
import { desmarcarCambioEnCurso, marcarCambioEnCurso } from "@/lib/cuentas/cambio-en-curso";
import { aplicarCuenta } from "@/lib/cuentas/cambio";
import { cerrarSesionConCuentas, type OpcionesCierre } from "@/lib/cuentas/cierre";
import { puertoCambioReal } from "@/lib/cuentas/puertos";
import { revocarSesion } from "@/lib/cuentas/sesion-aislada";
import { DESTINO_TRAS_AGREGAR } from "@/lib/cuentas/agregando-cuenta";
import { pedirRegistroPush } from "@/lib/push/registro";

export type { OpcionesCierre as OpcionesLogout };

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
 * Consciente de cuentas (decision D3): la logica vive en lib/cuentas/cierre.ts
 * con puertos y pruebas; aqui solo estan los cables (Supabase, boveda, Sentry)
 * y la navegacion. signOut() sigue siendo GLOBAL a proposito (es lo que este
 * boton ha hecho siempre y lo que se espera de el en un telefono compartido);
 * lo local es "Quitar" en la hoja de cuentas.
 */
export function useLogout() {
  const router = useRouter();

  return async (opciones?: OpcionesCierre): Promise<{ error?: string }> => {
    const supabase = createClient();
    const resultado = await cerrarSesionConCuentas(
      {
        async sesionActual() {
          const { data } = await conTope(supabase.auth.getSession());
          return data.session?.user.id ?? null;
        },
        // El token de FCM es por dispositivo, no por persona. Si no se limpia, el
        // perfil del que se va sigue apuntando a ESTE telefono, y cuando otra
        // persona entra, las notificaciones del anterior aterrizan en su
        // pantalla. Ya hubo dos cuentas compartiendo token en produccion.
        soltarTokenPush: (userId) => puertoCambioReal().soltarTokenPush(userId),
        pedirRegistroPush,
        revocar: (cuenta) =>
          revocarSesion(cuenta, (sesion) =>
            guardarCuenta({ ...cuenta, accessToken: sesion.access_token, refreshToken: sesion.refresh_token }),
          ),
        signOut: () => conTope(supabase.auth.signOut()),
        aplicar: (destino) => aplicarCuenta(destino, puertoCambioReal()),
        boveda: { quitar: quitarCuenta, vaciar: vaciarBoveda, cuentaMasReciente, cuentasDormidas },
        marcar: marcarCambioEnCurso,
        desmarcar: desmarcarCambioEnCurso,
        reportar(paso, error, nivel = "error", extra) {
          const estado = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
          Sentry.captureException(error, {
            level: nivel,
            tags: { hook: "useLogout", step: paso },
            contexts: { auth: { status: typeof estado === "number" ? estado : null } },
            extra,
          });
        },
      },
      opciones,
    );

    if (!resultado.ok) return { error: resultado.mensaje };

    if (!resultado.siguiente) {
      // Ya no hay sesion: el aviso va por toast porque quien llamo se desmonta.
      if (resultado.aviso) toast.error(resultado.aviso);
      router.push("/login");
      router.refresh();
      return {};
    }
    toast.success(`Ahora estás en ${resultado.siguiente.nombre}`);
    // Navegacion blanda, como en la hoja de cuentas (carrera de la cookie en iOS).
    router.refresh();
    setTimeout(() => router.replace(DESTINO_TRAS_AGREGAR), 50);
    return {};
  };
}
