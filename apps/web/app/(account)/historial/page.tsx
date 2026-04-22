import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, formatDate } from "@vicino/shared";
import { HistorialTabs } from "./historial-tabs";
import { ChevronLeft } from "lucide-react";

export const metadata = {
  title: "Historial",
};

export default async function HistorialPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/historial");

  // Sales as seller
  const { data: ventas } = await supabase
    .from("sale_confirmations")
    .select(
      `
      id, precio_acordado, cantidad, status, created_at, completed_at,
      buyer_id, seller_id,
      products_services(id, titulo, imagen_principal),
      buyer:profiles!buyer_id(nombre)
    `
    )
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  // Purchases as buyer
  const { data: compras } = await supabase
    .from("sale_confirmations")
    .select(
      `
      id, precio_acordado, cantidad, status, created_at, completed_at,
      buyer_id, seller_id,
      products_services(id, titulo, imagen_principal),
      seller:profiles!seller_id(nombre)
    `
    )
    .eq("buyer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  // Get reviews left by user to check which sales have been reviewed
  const { data: myReviews } = await supabase
    .from("reviews")
    .select("sale_confirmation_id, review_type")
    .eq("reviewer_id", user.id);

  const reviewedSales = new Set(
    myReviews?.map((r) => `${r.sale_confirmation_id}-${r.review_type}`) ?? []
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Inicio
      </Link>
      <h1 className="text-xl font-bold mb-4">Historial</h1>
      <HistorialTabs
        ventas={ventas ?? []}
        compras={compras ?? []}
        reviewedSales={reviewedSales}
        currentUserId={user.id}
      />
    </div>
  );
}
