import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function run() {
  const { data, error } = await supabase
    .from("profiles")
    .select("nombre")
    .textSearch("nombre", "taqueria", { type: "websearch", config: "spanish" });

  console.log("textSearch error:", error);
  console.log("textSearch data:", data);
}

run();
