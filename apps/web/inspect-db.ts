import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function inspect() {
  const { data: realProducts, error } = await supabase
    .from("products_services")
    .select("id, titulo, creador_id, categoria_id, imagen_principal")
    .not("titulo", "ilike", "%prueba%")
    .not("titulo", "ilike", "%Mega Tienda%")
    .limit(20);
    
  console.log("Real products found:", realProducts?.length);
  if (realProducts) {
    for (const p of realProducts) {
      console.log(`- ${p.titulo} (Cat: ${p.categoria_id})`);
    }
  }
}

inspect();
