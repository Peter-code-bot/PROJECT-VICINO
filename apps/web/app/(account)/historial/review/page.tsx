import { publicProfileName } from "@vicino/shared";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ReviewForm } from "./review-form";
import { ChevronLeft } from "lucide-react";
import { historialHref, parseHistorialLocation, type HistorialParams } from "@/lib/historial/navigation";

export const metadata = {
  title: "Dejar reseña",
};

// review_type es un enum de dos valores en la base, no texto libre. Se declara
// aqui como tupla para validar contra ella el parametro que llega por la URL.
const REVIEW_TYPES = ["buyer_to_seller", "seller_to_buyer"] as const;

interface Props {
  searchParams: Promise<HistorialParams>;
}

export default async function ReviewPage({ searchParams }: Props) {
  const params = await searchParams;
  const returnLocation = parseHistorialLocation({ ...params, tab: params.tab ?? (params.type === "buyer_to_seller" ? "compras" : "ventas") });
  const returnHref = historialHref(returnLocation);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  // `product` de la URL ya no se exige ni se usa: sale de la propia venta. Con el
  // producto pausado, agotado u oculto el embed llega nulo para el comprador y
  // el enlace de Historial mandaba product=undefined; el INSERT moria con
  // 22P02 y el vendedor no recibia la resena (S08, 27-sep).
  if (typeof params.sale !== "string" || !params.sale || typeof params.type !== "string") redirect(returnHref);

  // `type` viaja en la URL, asi que puede traer cualquier cosa. Se resuelve
  // contra los dos valores del enum antes de consultar, para que un valor
  // inventado se vaya al historial en vez de llegar al .eq() o al formulario.
  const reviewType = REVIEW_TYPES.find((t) => t === params.type);
  if (!reviewType) redirect(returnHref);

  // Verify the sale exists and is completed
  const { data: sale, error: saleError } = await supabase
    .from("sale_confirmations")
    .select("id, buyer_id, seller_id, product_id, status, products_services(titulo)")
    .eq("id", params.sale)
    .eq("status", "completed")
    .maybeSingle();

  if (saleError) throw new Error("No se pudo consultar la venta. Intenta de nuevo.");
  if (!sale) redirect(returnHref);

  const expectedReviewer = reviewType === "buyer_to_seller" ? sale.buyer_id : sale.seller_id;
  if (expectedReviewer !== user.id) redirect(returnHref);

  // Determine reviewed user
  const reviewedId =
    reviewType === "buyer_to_seller" ? sale.seller_id : sale.buyer_id;

  // Check if already reviewed
  const { data: existingReview, error: reviewError } = await supabase
    .from("reviews")
    .select("id")
    .eq("sale_confirmation_id", params.sale)
    .eq("review_type", reviewType)
    .eq("reviewer_id", user.id)
    .maybeSingle();

  if (reviewError) throw new Error("No se pudo comprobar tu reseña. Intenta de nuevo.");

  if (existingReview) redirect(returnHref);

  const { data: reviewedProfile } = await supabase
    .from("profiles")
    .select("nombre, es_vendedor, seller_type, nombre_negocio")
    .eq("id", reviewedId)
    .single();

  const product = Array.isArray(sale.products_services)
    ? sale.products_services[0]
    : sale.products_services;

  return (
    <div className="w-full min-w-0 max-w-lg mx-auto px-4 py-6 [overflow-wrap:anywhere]">
      <Link
        href={returnHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Volver al historial
      </Link>
      <h1 className="text-xl font-bold mb-2">Dejar reseña</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Evalúa a <strong>{publicProfileName(reviewedProfile, "Usuario")}</strong> por{" "}
        <strong>{product?.titulo ?? "Producto"}</strong>
      </p>
      <ReviewForm
        saleConfirmationId={params.sale}
        productId={sale.product_id}
        reviewedId={reviewedId}
        reviewType={reviewType}
        returnHref={returnHref}
      />
    </div>
  );
}
