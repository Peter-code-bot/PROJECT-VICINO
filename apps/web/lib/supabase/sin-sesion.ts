// Cliente de servidor SIN sesion: la llave anon y ninguna cookie.
//
// Para rutas que atienden a terceros (el webhook de WhatsApp): no hay usuario
// que representar, y la service_role NO vive en Vercel (ver
// openspec/changes/2026-07-09-eradicate-vercel-service-role-key). Todo lo que
// haga este cliente pasa por los GRANT de `anon` y por RLS como `anon`: solo
// puede llamar a los RPC que `anon` puede ejecutar, y esos RPC son los que
// deciden si la peticion es legitima (p. ej. verificando la firma de Meta).
import "server-only";

import { createClient } from "@supabase/supabase-js";
import { fetchConLimite } from "./fetch-con-limite";
import type { Database } from "@/types/database.types";

export function createClientSinSesion() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchConLimite(fetch, url) },
  });
}
