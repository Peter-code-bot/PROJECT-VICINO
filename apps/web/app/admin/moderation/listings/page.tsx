import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPrice, REPORT_REASON_LABELS, type ReportReason } from "@vicino/shared";
import { ReportRowActions } from "../report-row-actions";

export const metadata = { title: "Admin — Productos reportados" };

export default async function ListingsModerationPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: isAdmin } = user
    ? await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" })
    : { data: false };

  const { data: reports } = await supabase
    .from("reports")
    .select(`
      id, reason, description, status, created_at, target_id,
      reporter:profiles!reporter_id(nombre)
    `)
    .eq("target_type", "listing")
    .in("status", ["pending", "reviewed"])
    .order("created_at", { ascending: false });

  const targetIds = (reports ?? []).map((r) => r.target_id);
  const { data: listings } = targetIds.length > 0
    ? await supabase
        .from("products_services")
        .select(`
          id, titulo, precio, slug, categoria, is_hidden, estatus, imagen_principal,
          creador:profiles!creador_id(nombre, user_id)
        `)
        .in("id", targetIds)
    : { data: [] };

  const listingById = new Map((listings ?? []).map((l) => [l.id, l]));

  return (
    <div className="space-y-4">
      <Link
        href="/admin/moderation"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Volver
      </Link>
      <h1 className="text-xl font-bold">Productos reportados</h1>

      {!reports || reports.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">✅</p>
          <p className="font-medium">Sin productos reportados pendientes</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((rep) => {
            const listing = listingById.get(rep.target_id);
            const creador = listing && (Array.isArray(listing.creador) ? listing.creador[0] : listing.creador);
            const reporter = Array.isArray(rep.reporter) ? rep.reporter[0] : rep.reporter;
            return (
              <div key={rep.id} className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Reportado por {reporter?.nombre ?? "?"} · {formatDate(rep.created_at)}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-warning/10 text-warning">
                    {REPORT_REASON_LABELS[rep.reason as ReportReason] ?? rep.reason}
                  </span>
                </div>

                {rep.description && (
                  <p className="text-xs italic text-muted-foreground">&ldquo;{rep.description}&rdquo;</p>
                )}

                {listing ? (
                  <div className="rounded-md bg-muted/40 p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{listing.titulo}</span>
                      <Link
                        href={`/${listing.categoria}/${listing.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatPrice(Number(listing.precio))}</span>
                      <span>·</span>
                      <span>Vendedor: {creador?.nombre ?? "?"}</span>
                    </div>
                    <div className="flex gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${listing.is_hidden ? "bg-danger/10 text-danger" : "bg-emerald-trust/10 text-emerald-trust"}`}
                      >
                        {listing.is_hidden ? "Oculto" : "Visible"}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {listing.estatus}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Producto no encontrado</p>
                )}

                <ReportRowActions
                  reportId={rep.id}
                  targetType="listing"
                  targetId={rep.target_id}
                  targetHidden={listing?.is_hidden ?? false}
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
