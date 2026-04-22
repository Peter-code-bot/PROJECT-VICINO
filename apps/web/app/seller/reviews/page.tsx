import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RatingStars } from "@/components/shared/rating-stars";
import { formatDate } from "@vicino/shared";
import { ReviewTabs } from "./review-tabs";

export const metadata = { title: "Reseñas" };

export default async function ReviewsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Reviews received as seller
  const { data: received } = await supabase
    .from("reviews")
    .select("id, rating, comentario, respuesta, respuesta_fecha, created_at, profiles!reviewer_id(nombre)")
    .eq("reviewed_id", user.id)
    .eq("review_type", "buyer_to_seller")
    .eq("visible", true)
    .order("created_at", { ascending: false });

  // Reviews given as seller
  const { data: given } = await supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, profiles!reviewed_id(nombre)")
    .eq("reviewer_id", user.id)
    .eq("review_type", "seller_to_buyer")
    .order("created_at", { ascending: false });

  // Pending: completed sales without seller_to_buyer review
  const { data: completedSales } = await supabase
    .from("sale_confirmations")
    .select("id, products_services(id, titulo), buyer:profiles!buyer_id(nombre)")
    .eq("seller_id", user.id)
    .eq("status", "completed");

  const givenIds = new Set(given?.map((r) => r.id) ?? []);
  const { data: givenBySale } = await supabase
    .from("reviews")
    .select("sale_confirmation_id")
    .eq("reviewer_id", user.id)
    .eq("review_type", "seller_to_buyer");
  const reviewedSaleIds = new Set(givenBySale?.map((r) => r.sale_confirmation_id) ?? []);

  const pending = completedSales?.filter((s) => !reviewedSaleIds.has(s.id)) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Reseñas</h1>
      <ReviewTabs
        received={received ?? []}
        given={given ?? []}
        pending={pending}
        currentUserId={user.id}
      />
    </div>
  );
}
