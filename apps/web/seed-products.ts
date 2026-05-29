import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase credentials");
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

async function fixSeed() {
  const period = currentPeriod();

  // Pick the category we used last time, or just any category
  const { data: rankings } = await supabase
    .from("seller_rankings")
    .select("seller_id, category_id")
    .eq("period", period)
    .limit(3);

  if (!rankings || rankings.length === 0) {
    console.log("No rankings found to fix.");
    return;
  }

  const categoryId = rankings[0].category_id;
  const sellerIds = Array.from(new Set(rankings.map(r => r.seller_id)));

  console.log(`Fixing products for category ${categoryId} and ${sellerIds.length} sellers`);

  const { data: categoryData } = await supabase.from('categories').select('slug').eq('id', categoryId).single();
  const categorySlug = categoryData?.slug || 'comida';

  // We need to create a dummy product for each seller if they don't have one in this category
  for (const sellerId of sellerIds) {
    // Upsert a product with a known good coordinate
    // The default in the app is lat: 19.0414, lng: -98.2063
    
    // Create a new product
    const { error: insertError } = await supabase
      .from("products_services")
      .insert({
        creador_id: sellerId,
        categoria_id: categoryId,
        categoria: categorySlug,
        titulo: "Producto de prueba para Ranking",
        descripcion: "Generado automáticamente para probar el podio de rankings",
        precio: 100,
        estatus: "disponible",
        is_hidden: false,
        ubicacion_geo: 'SRID=4326;POINT(-98.2063 19.0414)'
      });

    if (insertError) {
      console.error(`Error creating product for seller ${sellerId}:`, insertError);
    } else {
      console.log(`Created dummy product for seller ${sellerId} at default coords.`);
    }
  }
}

fixSeed();
