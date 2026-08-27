import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

export function createClient() {
// El generic Database es lo que hace que tsc valide los nombres de columna
// de cada .select(). Sin el, un select de una columna que no existe compila
// y PostgREST devuelve { data: null, error }, que es como se perdieron cuatro
// selects en silencio. Los tipos se regeneran con: node scripts/gen-types.mjs
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
