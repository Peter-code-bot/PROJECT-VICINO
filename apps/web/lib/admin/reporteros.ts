import type { createClient } from "@/lib/supabase/server";

type Cliente = Awaited<ReturnType<typeof createClient>>;

export interface Reportero {
  id: string;
  nombre: string;
  user_id: string | null;
}

/**
 * Nombres de quienes reportaron, en una segunda consulta.
 *
 * reports.reporter_id solo tiene FK a auth.users, no a profiles, asi que el
 * embed `reporter:profiles!reporter_id(nombre)` que usaban las paginas del
 * panel de moderacion responde 400 PGRST200 ("Could not find a relationship
 * between 'reports' and 'profiles'") y, como ninguna miraba `error`, cada
 * cola se pintaba como "sin reportes pendientes" con reportes vivos. El
 * padron de perfiles se pide aparte, como ya se hacia con los targets.
 */
export async function reporterosPorId(
  supabase: Cliente,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, Reportero>> {
  const unicos = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (unicos.length === 0) return new Map();
  const { data } = await supabase.from("profiles").select("id, nombre, user_id").in("id", unicos);
  return new Map((data ?? []).map((p) => [p.id, { id: p.id, nombre: p.nombre, user_id: p.user_id }]));
}
