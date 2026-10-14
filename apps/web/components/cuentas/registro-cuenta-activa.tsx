"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { buscarCuenta, guardarCuenta, type DatosCuenta } from "@/lib/cuentas/boveda";
import { cambioEnCurso, desmarcarCambioEnCurso } from "@/lib/cuentas/cambio-en-curso";
import { limpiarAgregandoCuenta } from "@/lib/cuentas/agregando-cuenta";
import { aplicarCuenta } from "@/lib/cuentas/cambio";
import { puertoCambioReal } from "@/lib/cuentas/puertos";

export type CuentaActiva = Omit<DatosCuenta, "accessToken" | "refreshToken">;

const CLAVE_REINTENTO = "vicino_cambio_reintentado";

/**
 * El espejo de la cuenta ACTIVA en la boveda, montado en el layout del
 * marketplace con key={user.id}. Sin UI.
 *
 * 1. En cada INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED de la cuenta que el
 *    servidor pinto, reescribe su entrada con los tokens de la sesion y los
 *    datos de perfil que el layout ya consulto. Asi la activa siempre tiene en
 *    la boveda su ULTIMO refresh token, y una cuenta que entra por cualquier
 *    camino (contraseña, codigo, Google, Apple) queda registrada sin que las
 *    pantallas de auth sepan que la boveda existe.
 * 2. Cierra el "cambio en curso" si aterrizo la cuenta esperada. Si aterrizo
 *    la ANTERIOR (la cookie se piso con un refresh tardio de A), reaplica el
 *    cambio UNA vez; si tampoco, limpia la marca y avisa.
 * 3. Borra la cookie de "agregando cuenta": la persona ya esta dentro.
 *
 * El callback de onAuthStateChange no llama a nada de supabase: dentro de el
 * el cliente tiene tomado su cerrojo (la trampa documentada de supabase-js).
 */
export function RegistroCuentaActiva({ cuenta }: { cuenta: CuentaActiva }) {
  const router = useRouter();
  const cuentaRef = useRef(cuenta);
  useEffect(() => {
    cuentaRef.current = cuenta;
  }, [cuenta]);

  useEffect(() => {
    const supabase = createClient();
    let desmontado = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (desmontado || !sesion) return;
      if (evento !== "INITIAL_SESSION" && evento !== "SIGNED_IN" && evento !== "TOKEN_REFRESHED") return;
      // Un evento de OTRA cuenta a mitad de un cambio no es de esta instancia:
      // el layout se remonta con la nueva y es esa la que escribe.
      if (sesion.user.id !== cuentaRef.current.userId) return;
      guardarCuenta({
        ...cuentaRef.current,
        email: cuentaRef.current.email || sesion.user.email || "",
        accessToken: sesion.access_token,
        refreshToken: sesion.refresh_token,
      });
    });

    limpiarAgregandoCuenta();

    const esperado = cambioEnCurso();
    if (esperado) {
      if (esperado === cuenta.userId) {
        desmarcarCambioEnCurso();
        limpiarReintento();
      } else {
        void reintentarAterrizaje(esperado);
      }
    }

    async function reintentarAterrizaje(userIdEsperado: string) {
      const destino = buscarCuenta(userIdEsperado);
      let yaReintentado = false;
      try {
        yaReintentado = window.sessionStorage.getItem(CLAVE_REINTENTO) === userIdEsperado;
        window.sessionStorage.setItem(CLAVE_REINTENTO, userIdEsperado);
      } catch {
        // Sin sessionStorage no hay como contar: se reintenta una vez por montaje.
      }
      if (!destino || yaReintentado) {
        desmarcarCambioEnCurso();
        limpiarReintento();
        if (destino) toast.error("No se pudo cambiar de cuenta. Inténtalo de nuevo.");
        return;
      }
      const resultado = await aplicarCuenta(destino, puertoCambioReal());
      if (desmontado) return;
      if (resultado.ok) {
        router.refresh();
        return;
      }
      desmarcarCambioEnCurso();
      limpiarReintento();
      toast.error(resultado.mensaje);
    }

    return () => {
      desmontado = true;
      subscription.unsubscribe();
    };
    // Solo al montar: el layout remonta este componente con key={user.id}.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuenta.userId]);

  return null;
}

function limpiarReintento(): void {
  try {
    window.sessionStorage.removeItem(CLAVE_REINTENTO);
  } catch {
    // Nada que limpiar.
  }
}
