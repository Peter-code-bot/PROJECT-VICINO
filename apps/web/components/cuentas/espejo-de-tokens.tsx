"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { actualizarTokens } from "@/lib/cuentas/boveda";

/**
 * Mantiene al dia los TOKENS de la cuenta activa en la boveda en TODAS las
 * pantallas, no solo en el marketplace. Sin UI, montado en app/layout.tsx.
 *
 * Por que hace falta ademas de RegistroCuentaActiva: "Agregar cuenta" guarda
 * la cuenta actual y manda a /login, /register, al codigo de verificacion o al
 * Custom Tab de Google, y ahi RegistroCuentaActiva no esta montado. Mientras
 * tanto el cliente singleton sigue vivo con autoRefreshToken y, si al access
 * token le quedan menos de 90 s, rota el refresh token y emite TOKEN_REFRESHED.
 * Sin nadie que lo recoja, la boveda se quedaba con un refresh token ya
 * consumido y volver a esa cuenta la revocaba entera ("Already Used").
 *
 * Los refrescos que hace el SERVIDOR (el proxy o una accion de servidor, via
 * Set-Cookie) no emiten ningun evento en el cliente. Por eso, ademas de los
 * eventos, se relee la cookie al volver a primer plano, al recibir el foco y
 * al restaurar la pagina (pageshow): es barato con el token fresco (sin red) y
 * cubre la ventana entre un refresco del servidor y el siguiente evento.
 *
 * Solo ACTUALIZA entradas que ya existen (actualizarTokens no crea): no sabe
 * nada del perfil y no es quien decide que cuentas se guardan. El callback de
 * onAuthStateChange no llama a nada de supabase: corre con el cerrojo tomado.
 */
export function EspejoDeTokens() {
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (!sesion) return;
      if (evento !== "INITIAL_SESSION" && evento !== "SIGNED_IN" && evento !== "TOKEN_REFRESHED") return;
      actualizarTokens(sesion.user.id, { accessToken: sesion.access_token, refreshToken: sesion.refresh_token });
    });
    const releer = () => {
      if (document.visibilityState !== "visible") return;
      void supabase.auth.getSession().then(({ data }) => {
        const sesion = data.session;
        if (sesion) actualizarTokens(sesion.user.id, { accessToken: sesion.access_token, refreshToken: sesion.refresh_token });
      }).catch(() => {});
    };
    document.addEventListener("visibilitychange", releer);
    window.addEventListener("focus", releer);
    window.addEventListener("pageshow", releer);
    return () => {
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", releer);
      window.removeEventListener("focus", releer);
      window.removeEventListener("pageshow", releer);
    };
  }, []);
  return null;
}
