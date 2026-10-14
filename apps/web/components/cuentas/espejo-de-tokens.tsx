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
 * Solo ACTUALIZA entradas que ya existen (actualizarTokens no crea): no sabe
 * nada del perfil y no es quien decide que cuentas se guardan. El callback no
 * llama a nada de supabase: corre con el cerrojo del cliente tomado.
 */
export function EspejoDeTokens() {
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (!sesion) return;
      if (evento !== "INITIAL_SESSION" && evento !== "SIGNED_IN" && evento !== "TOKEN_REFRESHED") return;
      actualizarTokens(sesion.user.id, { accessToken: sesion.access_token, refreshToken: sesion.refresh_token });
    });
    return () => subscription.unsubscribe();
  }, []);
  return null;
}
