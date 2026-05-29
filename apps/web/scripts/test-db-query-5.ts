import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function run() {
  const queryStr = "%taqu_r_a%";
  const { data: d1 } = await supabase.from("profiles").select("nombre").ilike("nombre", queryStr);
  console.log(`ilike with ${queryStr}:`, d1);
}

run();
