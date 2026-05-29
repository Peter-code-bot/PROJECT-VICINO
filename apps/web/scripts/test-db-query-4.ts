import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function run() {
  const { data: d1 } = await supabase.from("profiles").select("nombre").textSearch("nombre", "'taqueria'", { config: "spanish" });
  console.log("textSearch with 'taqueria':", d1);

  const { data: d2 } = await supabase.from("profiles").select("nombre").textSearch("nombre", "Taquería", { config: "spanish" });
  console.log("textSearch with Taquería:", d2);
}

run();
