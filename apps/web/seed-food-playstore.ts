import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!, {
  auth: { autoRefreshToken: false, persistSession: false },
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

const foodData = [
  { 
    seller: "Taquería El Pastorcito",
    profileUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=150&auto=format&fit=crop",
    title: "Orden de Tacos al Pastor (5 pz)",
    price: 120,
    img: "https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Pizzería Napoli",
    profileUrl: "https://images.unsplash.com/photo-1560250097-0b93528c311a?q=80&w=150&auto=format&fit=crop",
    title: "Pizza Margarita Artesanal",
    price: 250,
    img: "https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Burgers & Co.",
    profileUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=150&auto=format&fit=crop",
    title: "Hamburguesa Doble Smash",
    price: 180,
    img: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Sushi Sakura",
    profileUrl: "https://images.unsplash.com/photo-1580489944761-15a19d654956?q=80&w=150&auto=format&fit=crop",
    title: "Rollo Spicy Tuna y Edamames",
    price: 220,
    img: "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Café de Especialidad",
    profileUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=150&auto=format&fit=crop",
    title: "Latte Frío con Leche de Avena",
    price: 85,
    img: "https://images.unsplash.com/photo-1497935586351-b67a49e012bf?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Repostería La Abuela",
    profileUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=150&auto=format&fit=crop",
    title: "Rebanada Pastel de Trufa",
    price: 110,
    img: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Fonda Mexicana",
    profileUrl: "https://images.unsplash.com/photo-1527980965255-d3b416303d12?q=80&w=150&auto=format&fit=crop",
    title: "Enchiladas Suizas Gratinadas",
    price: 140,
    img: "https://images.unsplash.com/photo-1534353473418-4cfa6c56fd38?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Cevichería El Puerto",
    profileUrl: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=150&auto=format&fit=crop",
    title: "Tostada de Ceviche Peruano",
    price: 160,
    img: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Churrería Tradicional",
    profileUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?q=80&w=150&auto=format&fit=crop",
    title: "Orden Churros con Chocolate",
    price: 90,
    img: "https://images.unsplash.com/photo-1624371414361-e670ead2d536?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Ramen House",
    profileUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=150&auto=format&fit=crop",
    title: "Ramen Tonkotsu Clásico",
    price: 210,
    img: "https://images.unsplash.com/photo-1557872943-16a5ac26437e?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Empanadas del Sur",
    profileUrl: "https://images.unsplash.com/photo-1554151228-14d9def656e4?q=80&w=150&auto=format&fit=crop",
    title: "Docena de Empanadas de Carne",
    price: 280,
    img: "https://images.unsplash.com/photo-1626200926732-47963d8d6411?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Gelato Artesanal",
    profileUrl: "https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=150&auto=format&fit=crop",
    title: "Helado Doble Pistache y Vainilla",
    price: 95,
    img: "https://images.unsplash.com/photo-1563805042-7684c8e9e5cb?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Alitas Fire",
    profileUrl: "https://images.unsplash.com/photo-1583864697784-a0efc8379f70?q=80&w=150&auto=format&fit=crop",
    title: "Alitas BBQ (10 piezas)",
    price: 190,
    img: "https://images.unsplash.com/photo-1524114664604-cd8133cd67ad?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Burritos El Güero",
    profileUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=150&auto=format&fit=crop",
    title: "Burrito Norteño de Arrachera",
    price: 150,
    img: "https://images.unsplash.com/photo-1626700051175-6818013e1d4f?q=80&w=600&auto=format&fit=crop"
  },
  {
    seller: "Té de Burbujas",
    profileUrl: "https://images.unsplash.com/photo-1607746882042-944635dfe10e?q=80&w=150&auto=format&fit=crop",
    title: "Boba Tea de Taro Frío",
    price: 100,
    img: "https://images.unsplash.com/photo-1558857563-b371034b7ae2?q=80&w=600&auto=format&fit=crop"
  }
];

async function seedFoodRankings() {
  const period = currentPeriod();
  
  // 1. Get Comida y Bebidas category
  const { data: catData } = await supabase.from("categories")
    .select("id, slug").ilike("nombre", "Comida y Bebidas").single();
    
  if (!catData) {
    console.error("Food category not found");
    return;
  }

  const categoryId = catData.id;
  const categorySlug = catData.slug;
  
  console.log("Seeding Food Rankings for Play Store...");
  
  const rankings = [];
  
  for (let i = 0; i < foodData.length; i++) {
    const item = foodData[i];
    const email = `playstore_food_${Date.now()}_${i}@vicino.test`;
    
    // Create auth user
    const { data: userAuth, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: "password123",
      email_confirm: true,
    });
    
    if (authError || !userAuth.user) {
      console.error("Failed to create user:", email);
      continue;
    }
    
    await new Promise(r => setTimeout(r, 600)); // allow trigger time
    
    // Update profile
    await supabase.from("profiles").update({
      es_vendedor: true,
      nombre: item.seller,
      display_name: item.seller,
      foto: item.profileUrl,
      trust_level: i < 3 ? "elite" : "confiable",
      trust_points: 980 - i * 10
    }).eq("id", userAuth.user.id);

    // Upsert if not exists
    await supabase.from("profiles").insert({
      id: userAuth.user.id,
      es_vendedor: true,
      nombre: item.seller,
      display_name: item.seller,
      foto: item.profileUrl,
      trust_level: i < 3 ? "elite" : "confiable",
      trust_points: 980 - i * 10
    }).select(); // just try, ignore error if duplicate

    // Insert Product
    await supabase.from("products_services").insert({
      creador_id: userAuth.user.id,
      categoria_id: categoryId,
      categoria: categorySlug,
      titulo: item.title,
      descripcion: "El mejor sabor garantizado de toda tu zona local. Pide ahora.",
      precio: item.price,
      estatus: "disponible",
      is_hidden: false,
      imagen_principal: item.img,
      ubicacion_geo: 'SRID=4326;POINT(-98.2063 19.0414)' // default local coords
    });
    
    // Build ranking entry
    rankings.push({
      seller_id: userAuth.user.id,
      category_id: categoryId,
      period: period,
      composite_score: 998 - (i * 11) - (Math.random() * 2),
      ventas_count: 500 - (i * 20),
      ingresos: 80000 - (i * 3000),
      rating_avg: Math.max(4.2, 4.9 - (i * 0.04)),
      response_avg_minutes: 2 + i,
      trust_points_snapshot: 980 - i * 10,
      is_frozen: false
    });
  }
  
  // Upsert rankings
  const { error: rankError } = await supabase
    .from("seller_rankings")
    .upsert(rankings, { onConflict: "seller_id, category_id, period" });
    
  if (rankError) {
    console.error("Error upserting rankings:", rankError);
  } else {
    console.log(`Successfully seeded ${rankings.length} premium food listings for Play Store!`);
  }
}

seedFoodRankings();
