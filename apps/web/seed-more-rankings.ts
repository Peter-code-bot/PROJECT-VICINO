import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase credentials in .env.local");
}

// Ensure we use the service role key for admin privileges
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

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

async function seedMoreRankings() {
  const period = currentPeriod();

  // 1. Get a category (Comida y Bebidas or any)
  const { data: categories } = await supabase.from("categories").select("id, slug").limit(1);
  if (!categories || categories.length === 0) {
    console.error("No categories found");
    return;
  }
  const categoryId = categories[0].id;
  const categorySlug = categories[0].slug;

  console.log(`Using category: ${categorySlug} (${categoryId})`);

  // 2. Get existing sellers
  let { data: sellers } = await supabase.from("profiles").select("id, nombre").eq("es_vendedor", true).limit(10);
  sellers = sellers || [];

  // 3. If we don't have 10 sellers, create missing ones
  const needed = 10 - sellers.length;
  if (needed > 0) {
    console.log(`Creating ${needed} new sellers...`);
    for (let i = 0; i < needed; i++) {
      const email = `test_seller_${Date.now()}_${i}@example.com`;
      const { data: userAuth, error: authError } = await supabase.auth.admin.createUser({
        email,
        password: "password123",
        email_confirm: true,
      });

      if (authError || !userAuth.user) {
        console.error("Error creating auth user:", authError);
        continue;
      }

      // The profile might be created by a trigger, but let's update it to be a seller
      await new Promise(r => setTimeout(r, 1000)); // wait for trigger
      
      const { error: profileError } = await supabase.from("profiles").update({
        es_vendedor: true,
        nombre: `Tienda de Prueba ${i+1}`,
        trust_level: "confiable",
        trust_points: 800
      }).eq("id", userAuth.user.id);
      
      if (profileError) {
        // If it doesn't exist, try insert
        await supabase.from("profiles").insert({
          id: userAuth.user.id,
          es_vendedor: true,
          nombre: `Tienda de Prueba ${i+1}`,
          trust_level: "confiable",
          trust_points: 800,
          display_name: `Tienda de Prueba ${i+1}`
        });
      }

      sellers.push({ id: userAuth.user.id, nombre: `Tienda de Prueba ${i+1}` });
    }
  }

  console.log(`Found/Created ${sellers.length} sellers.`);

  // 4. Create dummy products with coordinates and rank them
  const rankings = [];
  
  for (let index = 0; index < sellers.length; index++) {
    const seller = sellers[index];
    
    // Check if product exists
    const { data: existingProducts } = await supabase
      .from("products_services")
      .select("id")
      .eq("creador_id", seller.id)
      .eq("categoria_id", categoryId)
      .limit(1);

    if (!existingProducts || existingProducts.length === 0) {
      // Create product
      const { error: insertError } = await supabase
        .from("products_services")
        .insert({
          creador_id: seller.id,
          categoria_id: categoryId,
          categoria: categorySlug,
          titulo: `Especial de ${seller.nombre}`,
          descripcion: "Producto de prueba para llenar el ranking.",
          precio: 150 + (index * 10),
          estatus: "disponible",
          is_hidden: false,
          ubicacion_geo: 'SRID=4326;POINT(-98.2063 19.0414)' // default coords
        });

      if (insertError) {
        console.error(`Error creating product for seller ${seller.id}:`, insertError);
      }
    }

    // Prepare ranking data
    rankings.push({
      seller_id: seller.id,
      category_id: categoryId,
      period: period,
      composite_score: 1000 - (index * 50), // Decaying score for ranking
      ventas_count: 100 - (index * 5),
      ingresos: 20000 - (index * 1000),
      rating_avg: Math.max(3.0, 5.0 - (index * 0.1)),
      response_avg_minutes: 10 + (index * 2),
      trust_points_snapshot: 900 - (index * 20),
      is_frozen: false
    });
  }

  // 5. Upsert Rankings
  console.log("Upserting rankings...");
  const { error: rankError } = await supabase
    .from("seller_rankings")
    .upsert(rankings, { onConflict: "seller_id, category_id, period" });

  if (rankError) {
    console.error("Error upserting rankings:", rankError);
  } else {
    console.log(`Successfully seeded ${rankings.length} rankings!`);
  }
}

seedMoreRankings();
