import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileHeader } from "./profile-header";
import { ProfileTabs } from "./profile-tabs";
import { AccountMenuDrawer } from "@/components/profile/account-menu-drawer";
import { Menu, Pencil } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Mi perfil — VICINO" };

export default async function PerfilPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/perfil");

  // PII columns (email/telefono/rfc/coords/fcm_token) are revoked from the user
  // client (#2). get_my_profile() is a SECURITY DEFINER RPC that returns the
  // caller's OWN full profile row (auth.uid()-scoped) -- same shape as select("*").
  const { data: profile } = await supabase.rpc("get_my_profile");

  // Get user's products.
  // MP#08 #5c-4: SELECT expandido con product_categories embed para que la
  // data fluya al tipo ProfileTabsProps.products. Render visual de badges en
  // SortableProductCard esta DIFERIDO a 5c-4-bis: ese componente es
  // image-only (overlay con precio hover + badge PAUSADO existente) y
  // requiere diseno de overlay propio para no colisionar.
  let { data: products, error: productsError } = await supabase
    .from("products_services")
    .select("id, titulo, precio, imagen_principal, categoria, slug, estatus, ventas_count, sort_order, product_categories(is_primary, categories(slug, nombre))")
    .eq("creador_id", user.id)
    .neq("estatus", "eliminado")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  // Fallback si la migración de sort_order aún no se ha aplicado en la BD
  if (productsError && productsError.code === "42703") {
    const fallback = await supabase
      .from("products_services")
      .select("id, titulo, precio, imagen_principal, categoria, slug, estatus, ventas_count, product_categories(is_primary, categories(slug, nombre))")
      .eq("creador_id", user.id)
      .neq("estatus", "eliminado")
      .order("created_at", { ascending: false });

    products = fallback.data ? fallback.data.map(p => ({ ...p, sort_order: 0 })) : null;
  }

  // Get reviews received
  const { data: reviewsAsSeller } = await supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, review_type, reviewer_id, profiles!reviewer_id(nombre, foto), products_services!product_id(id, titulo, categoria, slug, imagen_principal, product_categories(is_primary, categories(slug)))")
    .eq("reviewed_id", user.id)
    .eq("review_type", "buyer_to_seller")
    .eq("visible", true)
    // LEFT JOIN deliberada: queremos preservar la reseña aunque el producto esté
    // eliminado. <ReviewProductLink> degrada a "Producto no disponible" si el
    // join devuelve null. NO cambiar a !inner — esconde reseñas históricas válidas.
    .eq("products_services.estatus", "disponible")
    .eq("products_services.is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: reviewsAsBuyer } = await supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, review_type, reviewer_id, profiles!reviewer_id(nombre, foto), products_services!product_id(id, titulo, categoria, slug, imagen_principal, product_categories(is_primary, categories(slug)))")
    .eq("reviewed_id", user.id)
    .eq("review_type", "seller_to_buyer")
    .eq("visible", true)
    // LEFT JOIN deliberada: queremos preservar la reseña aunque el producto esté
    // eliminado. <ReviewProductLink> degrada a "Producto no disponible" si el
    // join devuelve null. NO cambiar a !inner — esconde reseñas históricas válidas.
    .eq("products_services.estatus", "disponible")
    .eq("products_services.is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(10);

  // Count purchases
  const { count: purchaseCount } = await supabase
    .from("sale_confirmations")
    .select("id", { count: "exact", head: true })
    .eq("buyer_id", user.id)
    .eq("status", "completed");

  const { count: followersCount } = await supabase
    .from("store_follows")
    .select("id", { count: "exact", head: true })
    .eq("store_id", user.id);

  const { count: followingCount } = await supabase
    .from("store_follows")
    .select("id", { count: "exact", head: true })
    .eq("follower_id", user.id);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 md:pb-8 animate-fade-in-up">
      {/* Mobile drawer trigger & Edit button */}
      <div className="md:hidden flex justify-end gap-2 mb-4">
        {profile?.es_vendedor && (
          <Link
            href="?edit=products"
            scroll={false}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            aria-label="Editar productos"
          >
            <Pencil className="w-4 h-4" />
          </Link>
        )}
        <AccountMenuDrawer
          userName={profile?.nombre}
          userAvatar={profile?.foto}
          userId={profile?.user_id}
          userIsVendedor={profile?.es_vendedor ?? false}
          trigger={
            <button
              aria-label="Menú de cuenta"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            >
              <Menu className="w-5 h-5" />
            </button>
          }
        />
      </div>
      <ProfileHeader
        profile={profile}
        productCount={products?.length ?? 0}
        purchaseCount={purchaseCount ?? 0}
        followersCount={followersCount ?? 0}
        followingCount={followingCount ?? 0}
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
