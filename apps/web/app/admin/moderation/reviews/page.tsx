import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate, REPORT_REASON_LABELS, type ReportReason } from "@vicino/shared";
import { RatingStars } from "@/components/shared/rating-stars";
import { ReportRowActions } from "../report-row-actions";

export const metadata = { title: "Admin — Reseñas reportadas" };

export default async function ReviewsModerationPage() {
  const supabase = await createClient();

  // Determinar si el usuario es admin (para mostrar acción "Suspender autor")
  const { data: { user } } = await supabase.auth.getUser();
  const { data: isAdmin } = user
    ? await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" })
    : { data: false };

  const { data: reports } = await supabase
    .from("reports")
    .select(`
      id, reason, description, status, created_at, target_id,
      reporter:profiles!reporter_id(nombre, user_id)
    `)
    .eq("target_type", "review")
    .in("status", ["pending", "reviewed"])
    .order("created_at", { ascending: false });

  // Hidratar info de cada review reportada
  const targetIds = (reports ?? []).map((r) => r.target_id);
  const { data: reviews } = targetIds.length > 0
    ? await supabase
        .from("reviews")
        .select(`
          id, rating, comentario, is_hidden, visible, created_at,
          reviewer:profiles!reviewer_id(nombre, user_id),
          reviewed:profiles!reviewed_id(nombre, user_id)
        `)
        .in("id", targetIds)
    : { data: [] };

  const reviewById = new Map(
    (reviews ?? []).map((r) => [r.id, r])
  );

  return (
    <div className="space-y-4">
      <Link
        href="/admin/moderation"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Volver
      </Link>
      <h1 className="text-xl font-bold">Reseñas reportadas</h1>

      {!reports || reports.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">✅</p>
          <p className="font-medium">Sin reseñas reportadas pendientes</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((rep) => {
            const review = reviewById.get(rep.target_id);
            const reviewer = review && (Array.isArray(review.reviewer) ? review.reviewer[0] : review.reviewer);
            const reviewed = review && (Array.isArray(review.reviewed) ? review.reviewed[0] : review.reviewed);
            const reporter = Array.isArray(rep.reporter) ? rep.reporter[0] : rep.reporter;
            return (
              <div key={rep.id} className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Reportado por {reporter?.nombre ?? "?"} · {formatDate(rep.created_at)}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600">
                    {REPORT_REASON_LABELS[rep.reason as ReportReason] ?? rep.reason}
                  </span>
                </div>

                {rep.description && (
                  <p className="text-xs italic text-muted-foreground">&ldquo;{rep.description}&rdquo;</p>
                )}

                {review ? (
                  <div className="rounded-md bg-muted/40 p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {reviewer?.nombre ?? "?"} → {reviewed?.nombre ?? "?"}
                      </span>
                      <RatingStars rating={review.rating} size="sm" />
                    </div>
                    {review.comentario && <p className="text-sm">{review.comentario}</p>}
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full ${review.is_hidden ? "bg-red-50 text-red-500" : "bg-green-50 text-green-600"}`}
                    >
                      {review.is_hidden ? "Oculta" : "Visible"}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Reseña no encontrada (puede haber sido eliminada)</p>
                )}

                <ReportRowActions
                  reportId={rep.id}
                  targetType="review"
                  targetId={rep.target_id}
                  targetHidden={review?.is_hidden ?? false}
                  isAdmin={!!isAdmin}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
