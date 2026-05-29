import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function fixProducts() {
  console.log("Fetching all available products...");
  const { data: products, error } = await supabase
    .from("products_services")
    .select("id, creador_id, categoria, categoria_id, ubicacion_geo")
    .eq("estatus", "disponible");

  if (!products || products.length === 0) {
    console.error("No products found.");
    return;
  }

  const { data: categories } = await supabase.from("categories").select("id, slug");
  const catMap = new Map();
  categories?.forEach(c => catMap.set(c.slug, c.id));

  let updated = 0;

  for (const p of products) {
    let needsUpdate = false;
    const updates: any = {};

    // 1. Fix missing categoria_id
    if (!p.categoria_id && p.categoria) {
      const catId = catMap.get(p.categoria);
      if (catId) {
        updates.categoria_id = catId;
        needsUpdate = true;
      }
    }

    // 2. Fix missing ubicacion_geo
    if (!p.ubicacion_geo) {
      updates.ubicacion_geo = 'SRID=4326;POINT(-98.2063 19.0414)';
      needsUpdate = true;
    }

    if (needsUpdate) {
      const { error: updateError } = await supabase
        .from("products_services")
        .update(updates)
        .eq("id", p.id);
        
      if (updateError) {
        console.error("Error updating product", p.id, updateError);
      } else {
        updated++;
      }
    }
  }

  console.log(`Successfully updated ${updated} products with correct category_id and ubicacion_geo!`);
}

fixProducts();
