import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function run() {
  const q = "tacos al pastor";
  
  // PostgREST format requires double quotes for strings with spaces inside .or()
  let orQuery = `search_vector.wfts."${q}"`;

  const { data, error } = await supabase
    .from("products_services")
    .select("id, titulo, creador_id")
    .or(orQuery);

  console.log("Error:", error);
  console.log("Products:", data);
}

run();
