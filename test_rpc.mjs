import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function test() {
  console.log("Testing RPC...");
  const { data, error } = await supabase.rpc("search_nearby_products_v4", {
    user_lat: 19.041,
    user_lng: -98.206,
    radius_meters: 50000,
    result_limit: 150
  });

  if (error) {
    console.error("RPC Error:", error);
  } else {
    console.log("RPC Data length:", data?.length);
  }
}

test();
