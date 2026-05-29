import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function updateBrokenImages() {
  const updates = [
    {
      title: "Boba Tea de Taro Frío",
      img: "https://images.unsplash.com/photo-1596803244618-8dbee441d70b?q=80&w=600&auto=format&fit=crop"
    },
    {
      title: "Helado Doble Pistache y Vainilla",
      img: "https://images.unsplash.com/photo-1570197781417-0a5237500b49?q=80&w=600&auto=format&fit=crop"
    }
  ];

  for (const item of updates) {
    const { error } = await supabase
      .from("products_services")
      .update({ imagen_principal: item.img })
      .ilike("titulo", item.title);
    
    if (error) {
      console.error(`Failed to update ${item.title}:`, error);
    } else {
      console.log(`Updated ${item.title}`);
    }
  }
}

updateBrokenImages();
