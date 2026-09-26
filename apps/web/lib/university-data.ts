import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Same approved credential governs Home and Search; no client-supplied university. */
export async function getViewerUniversity(client: Client, userId: string) {
  const { data } = await client.from("seller_verification")
    .select("university_name").throwOnError()
    .eq("user_id", userId).eq("status", "approved")
    .eq("document_type", "Credencial Universitaria").maybeSingle();
  return data?.university_name?.trim() || null;
}

export async function getUniversitySellerIds(client: Client, university: string) {
  const { data } = await client.from("seller_verification")
    .select("user_id").throwOnError()
    .eq("university_name", university).eq("status", "approved")
    .eq("document_type", "Credencial Universitaria");
  return [...new Set((data ?? []).map(row => row.user_id))];
}
