import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileHeader } from "../../perfil/profile-header";
import { ProfileTabs } from "../../perfil/profile-tabs";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("nombre, nombre_negocio, seller_type")
    .eq("id", id)
    .single();
  const name =
    data?.seller_type === "business" && data?.nombre_negocio
      ? data.nombre_negocio
      : data?.nombre ?? "Vendedor";
  return { title: `${name} — VICINO` };
}

export default async function VendedorPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  // Public profile — explicitly exclude PII (email, telefono) and any field
  // not consumed by ProfileHeader/ProfileTabs. RLS allows anonymous read of
  // profiles, so the field list here is the actual privacy boundary.
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, nombre, foto, bio, user_id, ubicacion, es_vendedor, seller_type, nombre_negocio, categoria_negocio, metodos_pago_aceptados, trust_level, trust_points, total_sales, average_rating_as_seller, average_rating_as_buyer, reviews_count_as_seller, reviews_count_as_buyer, is_verified, created_at"
    )
    .eq("id", id)
    .single();

  if (!profile) notFound();

  // ProfileHeader expects an `email` field; on public profiles we never
  // surface the real email — pass empty string to satisfy the type.
  const publicProfile = { ...profile, email: "" };

  const { data: products } = await supabase
    .from("products_services")
    .select("id, titulo, precio, imagen_principal, categoria, slug, estatus, ventas_count")
    .eq("creador_id", id)
    .eq("estatus", "disponible")
    .order("created_at", { ascending: false });

  const { data: reviewsAsSeller } = await supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, review_type, profiles!reviewer_id(nombre, foto), products_services!product_id(id, titulo, categoria, slug, imagen_principal)")
    .eq("reviewed_id", id)
    .eq("review_type", "buyer_to_seller")
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: reviewsAsBuyer } = await supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, review_type, profiles!reviewer_id(nombre, foto), products_services!product_id(id, titulo, categoria, slug, imagen_principal)")
    .eq("reviewed_id", id)
    .eq("review_type", "seller_to_buyer")
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(10);

  const { count: purchaseCount } = await supabase
    .from("sale_confirmations")
    .select("id", { count: "exact", head: true })
    .eq("buyer_id", id)
    .eq("status", "completed");

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 md:pb-8 animate-fade-in-up">
      <ProfileHeader
        profile={publicProfile}
        productCount={products?.length ?? 0}
        purchaseCount={purchaseCount ?? 0}
        isPublic
      />
      <ProfileTabs
        products={products ?? []}
        reviewsAsSeller={reviewsAsSeller ?? []}
        reviewsAsBuyer={reviewsAsBuyer ?? []}
        isVendedor={publicProfile.es_vendedor ?? false}
      />
    </div>
  );
}
