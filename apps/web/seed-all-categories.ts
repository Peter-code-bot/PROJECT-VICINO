import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase credentials in .env.local");
}

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

async function seedCategoriesRankings() {
  const period = currentPeriod();

  // 1. Get ALL active categories
  const { data: categories } = await supabase.from("categories").select("id, slug, nombre").eq("activo", true);
  if (!categories || categories.length === 0) {
    console.error("No categories found");
    return;
  }
  
  console.log(`Found ${categories.length} active categories.`);

  // 2. We need 10 sellers minimum
  let { data: sellers } = await supabase.from("profiles").select("id, nombre").eq("es_vendedor", true).limit(30);
  sellers = sellers || [];
  
  const needed = 30 - sellers.length;
  if (needed > 0) {
    console.log(`Creating ${needed} more sellers...`);
    for (let i = 0; i < needed; i++) {
      const email = `test_seller_multi_${Date.now()}_${i}@example.com`;
      const { data: userAuth, error: authError } = await supabase.auth.admin.createUser({
        email,
        password: "password123",
        email_confirm: true,
      });

      if (authError || !userAuth.user) continue;

      await new Promise(r => setTimeout(r, 500)); // wait for trigger
      
      const { error: profileError } = await supabase.from("profiles").update({
        es_vendedor: true,
        nombre: `Mega Tienda ${i+1}`,
        trust_level: i % 3 === 0 ? "confiable" : "nuevo",
        trust_points: 800
      }).eq("id", userAuth.user.id);
      
      if (profileError) {
        await supabase.from("profiles").insert({
          id: userAuth.user.id,
          es_vendedor: true,
          nombre: `Mega Tienda ${i+1}`,
          trust_level: i % 3 === 0 ? "confiable" : "nuevo",
          trust_points: 800,
          display_name: `Mega Tienda ${i+1}`
        });
      }

      sellers.push({ id: userAuth.user.id, nombre: `Mega Tienda ${i+1}` });
    }
  }

  // Assign ~5-10 sellers per category randomly
  for (const category of categories) {
    console.log(`\nSeeding category: ${category.nombre}...`);
    const numSellers = Math.floor(Math.random() * 5) + 5; // 5 to 9 sellers per category
    
    // Shuffle sellers and take first 'numSellers'
    const shuffled = sellers.sort(() => 0.5 - Math.random()).slice(0, numSellers);
    const rankings = [];

    for (let index = 0; index < shuffled.length; index++) {
      const seller = shuffled[index];
      
      // Upsert a product for this seller in this category
      const { error: insertError } = await supabase
        .from("products_services")
        .insert({
          creador_id: seller.id,
          categoria_id: category.id,
          categoria: category.slug,
          titulo: `Servicio de ${category.nombre} por ${seller.nombre}`,
          descripcion: "Producto generado masivamente para probar rankings.",
          precio: 250 + (index * 50),
          estatus: "disponible",
          is_hidden: false,
          ubicacion_geo: 'SRID=4326;POINT(-98.2063 19.0414)' // default coords
        });

      if (insertError && insertError.code !== '23505') {
        // Ignore duplicate key errors if we run it multiple times
        console.error(`Error product for ${seller.id}:`, insertError.message);
      }

      rankings.push({
        seller_id: seller.id,
        category_id: category.id,
        period: period,
        composite_score: 1000 - (index * 60) - (Math.random() * 20),
        ventas_count: 80 - (index * 5),
        ingresos: 15000 - (index * 1000),
        rating_avg: Math.max(3.0, 5.0 - (index * 0.1)),
        response_avg_minutes: 5 + (index * 2),
        trust_points_snapshot: 900 - (index * 10),
        is_frozen: false
      });
    }

    const { error: rankError } = await supabase
      .from("seller_rankings")
      .upsert(rankings, { onConflict: "seller_id, category_id, period" });

    if (rankError) {
      console.error(`Error upserting rankings for ${category.nombre}:`, rankError);
    } else {
      console.log(`Added ${rankings.length} ranked sellers for ${category.nombre}.`);
    }
  }
}

seedCategoriesRankings();
