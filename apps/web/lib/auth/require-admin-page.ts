import "server-only";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Guarda de rol PARA PAGINAS que usan service_role.
 *
 * El guard de app/admin/layout.tsx NO basta: en una navegacion por RSC el
 * cliente manda el arbol de segmentos que ya tiene (Next-Router-State-Tree) y el
 * servidor renderiza solo el segmento que cambia, sin volver a ejecutar el
 * layout. Una pagina que crea el cliente de servicio tiene que comprobar el rol
 * ella misma, antes de crearlo (hallazgo PT09, 27-sep-2026).
 *
 * Responde 404 (no 500 ni un redirect que delate la ruta) si no hay sesion, si
 * no es admin o si la consulta del rol falla: ante la duda, se deniega.
 */
export async function requireAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: rol, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !rol) notFound();

  return { supabase, user };
}
