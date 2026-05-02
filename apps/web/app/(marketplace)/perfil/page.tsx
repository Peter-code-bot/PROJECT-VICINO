import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileHeader } from "./profile-header";
import { ProfileTabs } from "./profile-tabs";
import { AccountMenuDrawer } from "@/components/profile/account-menu-drawer";
import { Menu } from "lucide-react";

export const metadata = { title: "Mi perfil — VICINO" };

export default async function PerfilPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/perfil");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // Get user's products
  const { data: products } = await supabase
    .from("products_services")
    .select("id, titulo, precio, imagen_principal, categoria, slug, estatus, ventas_count")
    .eq("creador_id", user.id)
    .neq("estatus", "eliminado")
    .order("created_at", { ascending: false });

  // Get reviews received
  const { data: reviewsAsSeller } = await supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, review_type, reviewer_id, profiles!reviewer_id(nombre, foto), products_services!product_id(id, titulo, categoria, slug, imagen_principal)")
    .eq("reviewed_id", user.id)
    .eq("review_type", "buyer_to_seller")
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: reviewsAsBuyer } = await supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, review_type, reviewer_id, profiles!reviewer_id(nombre, foto), products_services!product_id(id, titulo, categoria, slug, imagen_principal)")
    .eq("reviewed_id", user.id)
    .eq("review_type", "seller_to_buyer")
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(10);

  // Count purchases
  const { count: purchaseCount } = await supabase
    .from("sale_confirmations")
    .select("id", { count: "exact", head: true })
    .eq("buyer_id", user.id)
    .eq("status", "completed");

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 md:pb-8 animate-fade-in-up">
      {/* Mobile drawer trigger */}
      <div className="md:hidden flex justify-end -mb-2">
        <AccountMenuDrawer
          userName={profile?.nombre}
          userAvatar={profile?.foto}
          userId={profile?.user_id}
          trigger={
            <button aria-label="Menú de cuenta" className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center text-foreground">
              <Menu className="w-6 h-6" />
            </button>
          }
        />
      </div>
      <ProfileHeader
        profile={profile}
        productCount={products?.length ?? 0}
        purchaseCount={purchaseCount ?? 0}
      />
      <ProfileTabs
        products={products ?? []}
        reviewsAsSeller={reviewsAsSeller ?? []}
        reviewsAsBuyer={reviewsAsBuyer ?? []}
        isVendedor={profile?.es_vendedor ?? false}
        currentUserId={user.id}
      />
    </div>
  );
}
