import { createClient } from "@/lib/supabase/server";

export async function requireAdminOrModerator() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // limit(1) + maybeSingle y no single: quien tiene LOS DOS roles saca dos
  // filas, y con single eso es un 406 PGRST116 con data null, o sea un admin
  // legitimo sin acceso. Basta con que exista una fila. Si la consulta falla,
  // data sigue siendo null y la puerta sigue cerrada.
  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["admin", "moderator"])
    .limit(1)
    .maybeSingle();

  if (!role) return null;
  return { supabase, user };
}
