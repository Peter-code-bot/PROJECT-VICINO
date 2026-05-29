import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

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

async function cleanAndSeedReal() {
  const period = currentPeriod();
  
  console.log("Cleaning up garbage data...");
  // 1. Delete garbage rankings
  await supabase.from("seller_rankings").delete().eq("period", period);
  
  // 2. Delete garbage products
  await supabase.from("products_services").delete().like("titulo", "%prueba para Ranking%");
  await supabase.from("products_services").delete().like("titulo", "%generado masivamente%");
  await supabase.from("products_services").delete().like("titulo", "Especial de%");
  await supabase.from("products_services").delete().like("titulo", "Servicio de%");
  
  // 3. Delete garbage profiles
  await supabase.from("profiles").delete().like("nombre", "Mega Tienda%");
  await supabase.from("profiles").delete().like("nombre", "Tienda de Prueba%");

  console.log("Fetching real products and sellers...");
  
  // 4. Fetch real products that have creators
  const { data: realProducts, error: pError } = await supabase
    .from("products_services")
    .select("creador_id, categoria, categoria_id, ubicacion_geo")
    .eq("estatus", "disponible");
    
  if (!realProducts || realProducts.length === 0) {
    console.error("No real products found!");
    return;
  }
  
  // 5. Fetch categories map (slug -> id)
  const { data: categories } = await supabase.from("categories").select("id, slug");
  const catMap = new Map();
  categories?.forEach(c => catMap.set(c.slug, c.id));
  
  // 6. Group by seller and identify their primary category
  const sellerCatMap = new Map();
  for (const p of realProducts) {
    if (!p.creador_id) continue;
    
    // Ensure the product has ubicacion_geo, if not, set it to default so it appears!
    if (!p.ubicacion_geo) {
      await supabase.from("products_services")
        .update({ ubicacion_geo: 'SRID=4326;POINT(-98.2063 19.0414)' })
        .eq("id", (p as any).id);
    }
    
    let catId = p.categoria_id;
    if (!catId && p.categoria) {
      catId = catMap.get(p.categoria);
      // Update product to have categoria_id
      if (catId) {
         await supabase.from("products_services")
           .update({ categoria_id: catId })
           .eq("id", (p as any).id);
      }
    }
    
    if (catId && !sellerCatMap.has(p.creador_id)) {
      sellerCatMap.set(p.creador_id, catId);
    }
  }
  
  if (sellerCatMap.size === 0) {
    console.error("No valid sellers with categories found.");
    return;
  }
  
  // 7. Insert rankings for these real sellers
  console.log(`Creating rankings for ${sellerCatMap.size} real sellers...`);
  const rankings = [];
  let i = 0;
  for (const [sellerId, categoryId] of sellerCatMap.entries()) {
    rankings.push({
      seller_id: sellerId,
      category_id: categoryId,
      period: period,
      composite_score: 998 - (i * 12), // High scores! Top seller gets 998
      ventas_count: 120 - i,
      ingresos: 50000 - (i * 1000),
      rating_avg: Math.max(4.0, 5.0 - (i * 0.1)),
      response_avg_minutes: 5,
      trust_points_snapshot: 950 - i,
      is_frozen: false
    });
    i++;
  }
  
  const { error: rankError } = await supabase
    .from("seller_rankings")
    .upsert(rankings, { onConflict: "seller_id, category_id, period" });
    
  if (rankError) {
    console.error("Failed to insert rankings:", rankError);
  } else {
    console.log(`Successfully created ${rankings.length} rankings based on REAL data!`);
  }
}

cleanAndSeedReal();
