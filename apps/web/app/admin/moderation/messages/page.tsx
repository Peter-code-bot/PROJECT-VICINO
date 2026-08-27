import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate, REPORT_REASON_LABELS, type ReportReason } from "@vicino/shared";
import { ReportRowActions } from "../report-row-actions";
import { firmarAdjuntos, leerAdjuntos } from "@/lib/chat/attachments";

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
          id, texto, chat_id, autor_id, is_hidden, created_at, attachments,
          autor:profiles!autor_id(nombre, user_id)
        `)
        .in("id", targetIds)
    : { data: [] };

  const messageById = new Map((messages ?? []).map((m) => [m.id, m]));

  // Las fotos del mensaje reportado, firmadas para que el panel pueda
  // verlas. Sin esto se moderaba a ciegas: la pagina leia `texto` y nada
  // mas, asi que una foto denunciada llegaba aqui como un mensaje en
  // blanco y la decision se tomaba sobre algo que no se habia visto.
  //
  // La firma sale del cliente con la sesion de quien modera, NO de una
  // clave de servicio: la policy de chat-media autoriza a admin y a
  // moderator explicitamente. Asi el acceso queda atado al rol real de la
  // persona y no a un permiso global del servidor.
  const adjuntosPorMensaje = new Map(
    (messages ?? []).map((m) => [m.id, leerAdjuntos(m.attachments)]),
  );
  const firmas = await firmarAdjuntos(
    supabase,
    [...adjuntosPorMensaje.values()].flat().map((a) => a.path),
  );

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
        El contenido —texto y fotos— se muestra solo aquí. No se incluye en
        alertas por email. Los enlaces de las fotos caducan en una hora.
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
                    {/* created_at no es NOT NULL en la base (solo tiene DEFAULT),
                        asi que la fecha puede faltar: guion en vez de "Invalid
                        Date", igual que el "?" del autor desconocido. */}
                    <div className="text-xs text-muted-foreground">
                      De: {autor?.nombre ?? "?"} ·{" "}
                      {message.created_at ? formatDate(message.created_at) : "—"}
                    </div>
                    {message.texto.trim() !== "" && (
                      <p className="text-sm whitespace-pre-wrap break-words">{message.texto}</p>
                    )}
                    {(adjuntosPorMensaje.get(message.id) ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {(adjuntosPorMensaje.get(message.id) ?? []).map((a) => {
                          const url = firmas.get(a.path);
                          return url ? (
                            // Se abre en pestana nueva y no en un visor propio:
                            // moderar suele necesitar el original a tamano completo,
                            // y la URL caduca en una hora igual.
                            <a
                              key={a.path}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={url}
                                alt="Foto adjunta al mensaje reportado"
                                className="h-24 w-24 rounded-md object-cover"
                              />
                            </a>
                          ) : (
                            <span
                              key={a.path}
                              className="flex h-24 w-24 items-center justify-center rounded-md bg-muted text-[10px] text-muted-foreground"
                            >
                              Foto no disponible
                            </span>
                          );
                        })}
                      </div>
                    )}
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
