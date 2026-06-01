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
    pending_confirmation: {
      label: "Pendiente",
      color:
        "bg-amber-400/10 text-amber-400 border border-amber-400/30 rounded-[var(--r-pill)] text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 font-medium",
    },
    completed: {
      label: "Completada",
      color:
        "bg-[color:var(--brand-tint)] text-[color:var(--trust-emerald)] border border-[color:var(--trust-emerald)]/30 rounded-[var(--r-pill)] text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 font-medium",
    },
    cancelled: {
      label: "Cancelada",
      color:
        "bg-[color:var(--danger)]/10 text-[color:var(--danger)] border border-[color:var(--danger)]/30 rounded-[var(--r-pill)] text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 font-medium",
    },
    expired: {
      label: "Expirada",
      color:
        "bg-[color:var(--bg-elev-2)] text-[color:var(--fg-dim)] border border-[color:var(--border)] rounded-[var(--r-pill)] text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 font-medium",
    },
  };

  return (
    <div className="space-y-6 min-w-0">
      <h1 className="text-xl font-bold truncate">Mis ventas</h1>

      {sales && sales.length > 0 ? (
        <div className="space-y-3">
          {sales.map((s) => {
            const product = Array.isArray(s.products_services) ? s.products_services[0] : s.products_services;
            const buyer = Array.isArray(s.buyer) ? s.buyer[0] : s.buyer;
            const status = statusConfig[s.status] ?? { label: s.status, color: "" };
            const canReview = s.status === "completed" && !reviewedIds.has(s.id);

            return (
              <div key={s.id} className="rounded-[var(--r-xl)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-4 hover:shadow-[var(--shadow-sm)] transition-all flex flex-row items-center justify-between gap-3 overflow-hidden min-w-0">
                <div className="flex flex-col min-w-0 space-y-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm truncate">
                      {buyer?.nombre ?? "Usuario"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[color:var(--fg-muted)] flex-wrap">
                    <span className="shrink-0">{new Date(s.created_at).toLocaleDateString('es-MX', {day: '2-digit', month: '2-digit', year: '2-digit'})}</span>
                    <span className="truncate max-w-[120px] sm:max-w-[200px]">{product?.titulo ?? "Producto"}</span>
                    {canReview && (
                      <Link
                        href={`/historial/review?sale=${s.id}&type=seller_to_buyer&product=${(product as { id?: string })?.id ?? ""}`}
                        className="text-[color:var(--brand-hi)] hover:underline shrink-0"
                      >
                        Evaluar '
                      </Link>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end shrink-0 pl-2 space-y-1">
                  <span className={`shrink-0 ${status.color}`}>
                    {status.label}
                  </span>
                  <span className="font-semibold text-sm">
                    {formatPrice(Number(s.precio_acordado))}
                    {s.cantidad > 1 && ` x${s.cantidad}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">🤝</p>
          <p className="font-medium">Sin ventas aún</p>
          <p className="text-sm text-[color:var(--fg-muted)]">
            Tus ventas confirmadas aparecerán aquí
          </p>
        </div>
      )}
    </div>
  );
}
