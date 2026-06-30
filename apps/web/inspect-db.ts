import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function check() {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, user_id, email, nombre");
  
  console.log("All profiles:");
  console.table(profiles);
}

check();
