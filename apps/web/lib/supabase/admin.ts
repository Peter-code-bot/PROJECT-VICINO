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

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
