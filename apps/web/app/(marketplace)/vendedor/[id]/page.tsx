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

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .single();

  if (!profile) notFound();

  const { data: products } = await supabase
    .from("products_services")
    .select("id, titulo, precio, imagen_principal, categoria, slug, estatus, ventas_count")
    .eq("creador_id", id)
    .eq("estatus", "disponible")
    .order("created_at", { ascending: false });

  const { data: reviewsAsSeller } = await supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, review_type, profiles!reviewer_id(nombre, foto)")
    .eq("reviewed_id", id)
    .eq("review_type", "buyer_to_seller")
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: reviewsAsBuyer } = await supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, review_type, profiles!reviewer_id(nombre, foto)")
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
        profile={profile}
        productCount={products?.length ?? 0}
        purchaseCount={purchaseCount ?? 0}
        isPublic
      />
      <ProfileTabs
        products={products ?? []}
        reviewsAsSeller={reviewsAsSeller ?? []}
        reviewsAsBuyer={reviewsAsBuyer ?? []}
        isVendedor={profile?.es_vendedor ?? false}
        hideLogout
      />
    </div>
  );
}
