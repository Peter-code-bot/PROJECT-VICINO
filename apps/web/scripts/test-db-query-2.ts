import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function run() {
  const { data: p1 } = await supabase.from("profiles").select("nombre").ilike("nombre", "%taqueria%");
  const { data: p2 } = await supabase.from("profiles").select("nombre").ilike("nombre", "%Taquería%");
  const { data: pr1 } = await supabase.from("products_services").select("titulo").ilike("titulo", "%taqueria%");
  const { data: pr2 } = await supabase.from("products_services").select("titulo").ilike("titulo", "%Taquería%");
  
  console.log("Profiles with 'taqueria':", p1);
  console.log("Profiles with 'Taquería':", p2);
  console.log("Products with 'taqueria':", pr1);
  console.log("Products with 'Taquería':", pr2);
}

run();
