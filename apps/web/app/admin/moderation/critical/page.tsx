import Link from "next/link";
import { ArrowLeft, AlertOctagon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate, REPORT_REASON_LABELS, type ReportReason } from "@vicino/shared";
import { CriticalReportForm } from "./critical-report-form";

export const metadata = { title: "Admin — Reportes críticos" };

/**
 * Vista exclusiva para reportes child_safety (CSAM). Muestra entradas en
 * critical_reports con authority_notified_at IS NULL (pendientes de denuncia
 * ante autoridad mexicana competente — Policía Cibernética / FGR).
 */
export default async function CriticalReportsPage() {
  const supabase = await createClient();

  const { data: pending } = await supabase
    .from("critical_reports")
    .select(`
      id, created_at, notes,
      report:reports!report_id(
        id, target_type, target_id, description, created_at,
        reporter:profiles!reporter_id(nombre, user_id)
      )
    `)
    .is("authority_notified_at", null)
    .order("created_at", { ascending: true });

  const { data: notified, count: notifiedCount } = await supabase
    .from("critical_reports")
    .select("id, authority_notified_at, authority_notification_reference, created_at", { count: "exact" })
    .not("authority_notified_at", "is", null)
    .order("authority_notified_at", { ascending: false })
    .limit(10);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/moderation"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Volver
      </Link>

      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <AlertOctagon className="w-5 h-5 text-red-600" />
          Reportes críticos — Acción legal
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Reportes de seguridad infantil pendientes de denuncia ante autoridad
          mexicana competente (Policía Cibernética / FGR). Los targets ya fueron
          auto-ocultados.
        </p>
      </div>

      <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 space-y-2">
        <p className="text-sm font-semibold text-red-700 dark:text-red-300">
          Procedimiento de denuncia
        </p>
        <ol className="text-xs text-red-700 dark:text-red-300 space-y-1 list-decimal list-inside">
          <li>Recopilar evidencia (capturas, target_id, reporter info).</li>
          <li>Presentar denuncia ante <strong>Policía Cibernética CDMX/Estatal</strong> o <strong>FGR — Fiscalía Especial</strong>.</li>
          <li>Obtener folio/expediente.</li>
          <li>Marcar abajo el reporte como notificado con folio.</li>
          <li>Conservar comprobantes ≥ 5 años (obligación legal).</li>
        </ol>
      </div>

      {!pending || pending.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">✅</p>
          <p className="font-medium">Sin reportes críticos pendientes</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((cr) => {
            const r = Array.isArray(cr.report) ? cr.report[0] : cr.report;
            const reporter = r && (Array.isArray(r.reporter) ? r.reporter[0] : r.reporter);
            if (!r) return null;
            return (
              <div key={cr.id} className="rounded-lg border border-red-500/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Recibido {formatDate(cr.created_at)}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 font-semibold">
                    CHILD_SAFETY
                  </span>
                </div>

                <div className="space-y-1">
                  <p className="text-sm">
                    <strong>Target:</strong> {r.target_type} / <code className="text-xs">{r.target_id}</code>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Reportado por: {reporter?.nombre ?? "?"}
                    {reporter?.user_id ? ` (@${reporter.user_id})` : ""}
                  </p>
                  {r.description && (
                    <p className="text-sm italic text-muted-foreground">&ldquo;{r.description}&rdquo;</p>
                  )}
                </div>

                <CriticalReportForm criticalReportId={cr.id} />
              </div>
            );
          })}
        </div>
      )}

      {notified && notified.length > 0 && (
        <details className="rounded-xl border border-border/40 p-4">
          <summary className="text-sm font-medium cursor-pointer">
            Historial de denuncias presentadas ({notifiedCount ?? 0})
          </summary>
          <div className="mt-3 space-y-2 text-xs">
            {notified.map((n) => (
              <div key={n.id} className="flex items-center justify-between border-t border-border/40 pt-2 first:border-t-0 first:pt-0">
                <span className="text-muted-foreground">
                  Folio: <code>{n.authority_notification_reference ?? "(sin folio)"}</code>
                </span>
                <span className="text-muted-foreground">
                  {n.authority_notified_at ? formatDate(n.authority_notified_at) : "—"}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
