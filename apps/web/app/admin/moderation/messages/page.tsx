import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate, REPORT_REASON_LABELS, type ReportReason } from "@vicino/shared";
import { ReportRowActions } from "../report-row-actions";

export const metadata = { title: "Admin — Mensajes reportados" };

/**
 * Visor de mensajes reportados. A diferencia de listings/reviews/users, el
 * texto del mensaje SOLO se muestra dentro del panel admin (nunca en el email
 * de alerta). Acceso a este panel está auditado vía bitácora server-side.
 */
export default async function MessagesModerationPage() {
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
    .eq("target_type", "message")
    .in("status", ["pending", "reviewed"])
    .order("created_at", { ascending: false });

  const targetIds = (reports ?? []).map((r) => r.target_id);
  const { data: messages } = targetIds.length > 0
    ? await supabase
        .from("messages")
        .select(`
          id, texto, chat_id, autor_id, is_hidden, created_at,
          autor:profiles!autor_id(nombre, user_id)
        `)
        .in("id", targetIds)
    : { data: [] };

  const messageById = new Map((messages ?? []).map((m) => [m.id, m]));

  return (
    <div className="space-y-4">
      <Link
        href="/admin/moderation"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Volver
      </Link>
      <h1 className="text-xl font-bold">Mensajes reportados</h1>
      <p className="text-xs text-muted-foreground">
        El contenido se muestra solo aquí. No se incluye en alertas por email.
      </p>

      {!reports || reports.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">✅</p>
          <p className="font-medium">Sin mensajes reportados pendientes</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((rep) => {
            const message = messageById.get(rep.target_id);
            const autor = message && (Array.isArray(message.autor) ? message.autor[0] : message.autor);
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

                {message ? (
                  <div className="rounded-md bg-muted/40 p-3 space-y-1.5">
                    <div className="text-xs text-muted-foreground">
                      De: {autor?.nombre ?? "?"} · {formatDate(message.created_at)}
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words">{message.texto}</p>
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full ${message.is_hidden ? "bg-red-50 text-red-500" : "bg-green-50 text-green-600"}`}
                    >
                      {message.is_hidden ? "Oculto" : "Visible"}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Mensaje no encontrado</p>
                )}

                <ReportRowActions
                  reportId={rep.id}
                  targetType="message"
                  targetId={rep.target_id}
                  targetHidden={message?.is_hidden ?? false}
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
