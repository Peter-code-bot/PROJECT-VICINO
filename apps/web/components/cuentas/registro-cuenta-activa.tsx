"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { actualizarPerfil, buscarCuenta, guardarCuenta, type DatosCuenta } from "@/lib/cuentas/boveda";
import { cambioEnCurso, desmarcarCambioEnCurso } from "@/lib/cuentas/cambio-en-curso";
import { limpiarAgregandoCuenta } from "@/lib/cuentas/agregando-cuenta";
import { aplicarCuenta } from "@/lib/cuentas/cambio";
import { puertoCambioReal, reportarCuentas } from "@/lib/cuentas/puertos";
import { revocarSesion } from "@/lib/cuentas/sesion-aislada";
import { sessionIdDeJwt } from "@/lib/cuentas/jwt";
import { pedirRegistroPush } from "@/lib/push/registro";

export type CuentaActiva = Omit<DatosCuenta, "accessToken" | "refreshToken">;

/**
 * Para que cuenta se reintento ya el aterrizaje en ESTA carga. A nivel de
 * modulo y no en sessionStorage: en desarrollo, StrictMode monta dos veces y
 * un contador en sessionStorage hacia que el segundo montaje se creyera el
 * reintento ya hecho.
 */
let reintentoHecho: string | null = null;
let bovedaLlenaAvisada = false;

/**
 * El espejo de la cuenta ACTIVA en la boveda, montado en el layout del
 * marketplace con key={user.id}. Sin UI.
 *
 * 1. En cada INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED de la cuenta que el
 *    servidor pinto, reescribe su entrada con los tokens de la sesion y los
 *    datos de perfil que el layout ya consulto. Asi una cuenta que entra por
 *    cualquier camino (contraseña, codigo, Google, Apple) queda registrada sin
 *    que las pantallas de auth sepan que la boveda existe. (Los tokens en las
 *    demas pantallas los mantiene EspejoDeTokens, en el layout raiz.)
 * 2. Cierra el "cambio en curso" si aterrizo la cuenta esperada. Si aterrizo
 *    la ANTERIOR (la cookie se piso con un refresh tardio de A), reaplica el
 *    cambio UNA vez; si tampoco, limpia la marca y avisa. Se comprueba en cada
 *    render del servidor (`renderId`), no solo al montar: con navegacion
 *    blanda y la misma cuenta, React conserva la instancia.
 * 3. Borra la cookie de "agregando cuenta" y pide registrar el dispositivo
 *    para push: entrar por la accion de servidor no emite SIGNED_IN.
 *
 * El callback de onAuthStateChange no llama a nada de supabase: dentro de el
 * el cliente tiene tomado su cerrojo (la trampa documentada de supabase-js).
 */
export function RegistroCuentaActiva({ cuenta, renderId }: { cuenta: CuentaActiva; renderId: string }) {
  const router = useRouter();
  const cuentaRef = useRef(cuenta);
  useEffect(() => {
    cuentaRef.current = cuenta;
    // El perfil se edito y el layout volvio a renderizar con la misma cuenta:
    // la boveda tiene que decir lo mismo que la cabecera del cajon, sin
    // esperar al siguiente evento de auth (hasta una hora).
    actualizarPerfil(cuenta.userId, { nombre: cuenta.nombre, username: cuenta.username, foto: cuenta.foto, email: cuenta.email });
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
      // Si la cuenta ya estaba en la boveda con OTRA sesion de GoTrue (la
      // persona volvio a entrar por /login en una cuenta que ya tenia
      // guardada), pisar la entrada dejaria la sesion vieja viva en el
      // servidor para siempre (las sesiones no caducan). Se revoca esa, y solo
      // esa, con el cliente aislado, fuera de este callback (cerrojo tomado).
      const previa = buscarCuenta(sesion.user.id);
      if (previa && previa.refreshToken !== sesion.refresh_token) {
        const sesionVieja = sessionIdDeJwt(previa.accessToken);
        const sesionNueva = sessionIdDeJwt(sesion.access_token);
        if (sesionVieja && sesionNueva && sesionVieja !== sesionNueva) {
          const huerfana = { accessToken: previa.accessToken, refreshToken: previa.refreshToken };
          setTimeout(() => {
            void revocarSesion(huerfana).then((r) => {
              if (!r.ok) reportarCuentas("revocar_huerfana", r.error, "warning");
            });
          }, 0);
        }
      }
      const resultado = guardarCuenta({
        ...cuentaRef.current,
        email: cuentaRef.current.email || sesion.user.email || "",
        accessToken: sesion.access_token,
        refreshToken: sesion.refresh_token,
      });
      // La activa sin sitio en la boveda (5 dormidas de otras cuentas): la
      // hoja lo explica; aqui solo se deja constancia una vez por carga.
      if (resultado === "llena" && !bovedaLlenaAvisada) {
        bovedaLlenaAvisada = true;
        reportarCuentas("espejo_activa", new Error("boveda llena: la cuenta activa no cabe"), "warning");
      }
    });

    limpiarAgregandoCuenta();
    pedirRegistroPush();

    return () => {
      desmontado = true;
      subscription.unsubscribe();
    };
  }, [cuenta.userId]);

  useEffect(() => {
    const esperado = cambioEnCurso();
    if (!esperado) return;
    if (esperado === cuenta.userId) {
      desmarcarCambioEnCurso();
      reintentoHecho = null;
      return;
    }
    const destino = buscarCuenta(esperado);
    if (!destino || reintentoHecho === esperado) {
      desmarcarCambioEnCurso();
      reintentoHecho = null;
      if (destino) toast.error("No se pudo cambiar de cuenta. Inténtalo de nuevo.");
      return;
    }
    reintentoHecho = esperado;
    let cancelado = false;
    void aplicarCuenta(destino, puertoCambioReal()).then((resultado) => {
      if (cancelado) return;
      if (resultado.ok) {
        router.refresh();
        return;
      }
      desmarcarCambioEnCurso();
      toast.error(resultado.mensaje);
    });
    return () => {
      cancelado = true;
    };
  }, [cuenta.userId, renderId, router]);

  return null;
}
