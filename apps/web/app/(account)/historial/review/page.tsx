import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ReviewForm } from "./review-form";
import { ChevronLeft } from "lucide-react";

export const metadata = {
  title: "Dejar reseña",
};

// review_type es un enum de dos valores en la base, no texto libre. Se declara
// aqui como tupla para validar contra ella el parametro que llega por la URL.
const REVIEW_TYPES = ["buyer_to_seller", "seller_to_buyer"] as const;

interface Props {
  searchParams: Promise<{ sale?: string; type?: string; product?: string }>;
}

export default async function ReviewPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!params.sale || !params.type || !params.product) redirect("/historial");

  // `type` viaja en la URL, asi que puede traer cualquier cosa. Se resuelve
  // contra los dos valores del enum antes de consultar, para que un valor
  // inventado se vaya al historial en vez de llegar al .eq() o al formulario.
  const reviewType = REVIEW_TYPES.find((t) => t === params.type);
  if (!reviewType) redirect("/historial");

  // Verify the sale exists and is completed
  const { data: sale } = await supabase
    .from("sale_confirmations")
    .select("id, buyer_id, seller_id, status, products_services(titulo)")
    .eq("id", params.sale)
    .eq("status", "completed")
    .single();

  if (!sale) redirect("/historial");

  // Determine reviewed user
  const reviewedId =
    reviewType === "buyer_to_seller" ? sale.seller_id : sale.buyer_id;

  // Check if already reviewed
  const { data: existingReview } = await supabase
    .from("reviews")
    .select("id")
    .eq("sale_confirmation_id", params.sale)
    .eq("review_type", reviewType)
    .single();

  if (existingReview) redirect("/historial");

  const { data: reviewedProfile } = await supabase
    .from("profiles")
    .select("nombre")
    .eq("id", reviewedId)
    .single();

  const product = Array.isArray(sale.products_services)
    ? sale.products_services[0]
    : sale.products_services;

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <Link
        href="/historial"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Volver al historial
      </Link>
      <h1 className="text-xl font-bold mb-2">Dejar reseña</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Evalúa a <strong>{reviewedProfile?.nombre ?? "Usuario"}</strong> por{" "}
        <strong>{product?.titulo ?? "Producto"}</strong>
      </p>
      <ReviewForm
        saleConfirmationId={params.sale}
        productId={params.product}
        reviewedId={reviewedId}
        reviewType={reviewType}
      />
    </div>
  );
}
