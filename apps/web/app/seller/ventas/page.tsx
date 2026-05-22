import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, formatDate } from "@vicino/shared";

export const metadata = { title: "Mis ventas" };

export default async function VentasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: sales } = await supabase
    .from("sale_confirmations")
    .select(
      `
      id, precio_acordado, cantidad, status, created_at, completed_at,
      products_services(titulo),
      buyer:profiles!buyer_id(nombre)
    `
    )
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  // Check which sales have seller reviews
  const { data: myReviews } = await supabase
    .from("reviews")
    .select("sale_confirmation_id")
    .eq("reviewer_id", user.id)
    .eq("review_type", "seller_to_buyer");

  const reviewedIds = new Set(myReviews?.map((r) => r.sale_confirmation_id) ?? []);

  const statusConfig: Record<string, { label: string; color: string }> = {
    pending_confirmation: { label: "Pendiente", color: "bg-warning/10 text-warning" },
    completed: { label: "Completada", color: "bg-emerald-trust/10 text-emerald-trust" },
    cancelled: { label: "Cancelada", color: "bg-danger/10 text-danger" },
    expired: { label: "Expirada", color: "bg-muted text-muted-foreground" },
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Mis ventas</h1>

      {sales && sales.length > 0 ? (
        <div className="space-y-3">
          {sales.map((s) => {
            const product = Array.isArray(s.products_services) ? s.products_services[0] : s.products_services;
            const buyer = Array.isArray(s.buyer) ? s.buyer[0] : s.buyer;
            const status = statusConfig[s.status] ?? { label: s.status, color: "" };
            const canReview = s.status === "completed" && !reviewedIds.has(s.id);

            return (
              <div key={s.id} className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm truncate">
                    {product?.titulo ?? "Producto"}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.color}`}>
                    {status.label}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Comprador: {buyer?.nombre ?? "Usuario"}</span>
                  <span>{formatDate(s.created_at)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">
                    {formatPrice(Number(s.precio_acordado))}
                    {s.cantidad > 1 && ` x${s.cantidad}`}
                  </span>
                  {canReview && (
                    <Link
                      href={`/historial/review?sale=${s.id}&type=seller_to_buyer&product=${(product as { id?: string })?.id ?? ""}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Evaluar comprador →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">🤝</p>
          <p className="font-medium">Sin ventas aún</p>
          <p className="text-sm text-muted-foreground">
            Tus ventas confirmadas aparecerán aquí
          </p>
        </div>
      )}
    </div>
  );
}
