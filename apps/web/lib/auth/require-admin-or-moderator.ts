import { createClient } from "@/lib/supabase/server";

export async function requireAdminOrModerator() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["admin", "moderator"])
    .single();

  if (!role) return null;
  return { supabase, user };
}
