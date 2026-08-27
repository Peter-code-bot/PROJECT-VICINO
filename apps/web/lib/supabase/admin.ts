// Importar este modulo desde un componente de cliente pasa a ser un error de
// COMPILACION, no una sorpresa en ejecucion.
//
// Sin esto, un import accidental compilaba: process.env.SUPABASE_SERVICE_ROLE_KEY
// llega undefined en el navegador, asi que la clave no se filtraba, pero el
// fallo aparecia como un 401 raro en tiempo de ejecucion en vez de senalar la
// linea culpable. Revisado hoy (item 134): hoy ningun componente de cliente lo
// importa, la variable no esta prefijada NEXT_PUBLIC y app/admin/layout.tsx
// comprueba el rol contra user_roles antes de renderizar cualquier /admin/*.
import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export function createAdminClient() {
// El generic Database es lo que hace que tsc valide los nombres de columna
// de cada .select(). Sin el, un select de una columna que no existe compila
// y PostgREST devuelve { data: null, error }, que es como se perdieron cuatro
// selects en silencio. Los tipos se regeneran con: node scripts/gen-types.mjs
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
