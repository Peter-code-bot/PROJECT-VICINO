import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase credentials in .env.local");
}

const supabase = createClient(supabaseUrl, supabaseKey);

function currentPeriod(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

async function seedRankings() {
  const period = currentPeriod();
  
  // Get at least 1 category
  const { data: categories } = await supabase.from("categories").select("id").limit(1);
  if (!categories || categories.length === 0) {
    console.error("No categories found");
    return;
  }
  const categoryId = categories[0].id;
  
  // Get 3 sellers (es_vendedor = true)
  const { data: sellers } = await supabase.from("profiles").select("id").eq("es_vendedor", true).limit(3);
  
  if (!sellers || sellers.length < 3) {
    console.error(`Not enough sellers found. Found: ${sellers?.length}`);
    return;
  }
  
  console.log(`Seeding rankings for period ${period} and category ${categoryId}`);
  
  // Prepare 3 rankings
  const rankings = sellers.map((seller, index) => ({
    seller_id: seller.id,
    category_id: categoryId,
    period: period,
    composite_score: 1000 - (index * 100), // 1000, 900, 800
    ventas_count: 50 - (index * 10),
    ingresos: 10000 - (index * 2000),
    rating_avg: 4.5 + (index * 0.1),
    response_avg_minutes: 15,
    trust_points_snapshot: 100,
    is_frozen: false
  }));
  
  const { error } = await supabase
    .from("seller_rankings")
    .upsert(rankings, { onConflict: "seller_id, category_id, period" });
    
  if (error) {
    console.error("Error inserting rankings:", error);
  } else {
    console.log("Successfully seeded 3 rankings!");
  }
}

seedRankings();
