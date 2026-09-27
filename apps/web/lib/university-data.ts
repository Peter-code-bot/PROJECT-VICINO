import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Same approved credential governs Home and Search; no client-supplied university. */
export async function getViewerUniversity(client: Client, userId: string) {
  const { data } = await client.from("seller_verification")
    .select("university_name").throwOnError()
    .eq("user_id", userId).eq("status", "approved")
    .eq("document_type", "Credencial Universitaria")
    // El historial admite varias filas por usuario: con dos aprobadas,
    // maybeSingle() a secas fallaba y el usuario perdia el chip universitario.
    .order("reviewed_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  return data?.university_name?.trim() || null;
}

/**
 * Companeros verificados de la universidad. Va con el cliente de servicio: la
 * RLS de seller_verification solo deja leer la fila propia, asi que con la
 * sesion del usuario esto devolvia solo a el mismo y el modo campus salia
 * vacio para todo el que no fuera admin (hallado en staging el 26-sep).
 * `university` debe venir SIEMPRE de getViewerUniversity (credencial aprobada
 * del propio usuario), nunca del cliente; y solo se devuelven ids.
 */
export async function getUniversitySellerIds(university: string) {
  const { data } = await createAdminClient().from("seller_verification")
    .select("user_id").throwOnError()
    .eq("university_name", university).eq("status", "approved")
    .eq("document_type", "Credencial Universitaria");
  return [...new Set((data ?? []).map(row => row.user_id))];
}
