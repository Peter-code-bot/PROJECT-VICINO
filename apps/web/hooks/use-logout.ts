"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import * as Sentry from "@sentry/nextjs";

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
 */
export function useLogout() {
  const router = useRouter();

  return async (): Promise<{ error?: string }> => {
    const supabase = createClient();

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

    const { error } = await supabase.auth.signOut();
    if (error) {
      Sentry.captureException(error, {
        tags: { hook: "useLogout" },
        contexts: { auth: { name: error.name, status: error.status ?? null } },
      });
      return { error: "No se pudo cerrar tu sesión. Revisa tu conexión e inténtalo de nuevo." };
    }
    router.push("/login");
    router.refresh();
    return {};
  };
}
