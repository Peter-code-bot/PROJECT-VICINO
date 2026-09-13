import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate, REPORT_REASON_LABELS, type ReportReason } from "@vicino/shared";
import { ReportRowActions } from "../report-row-actions";

export const metadata = { title: "Admin — Publicaciones de comunidad reportadas" };

/**
 * Publicaciones y comentarios del muro de una comunidad con reportes vivos.
 *
 * El texto se lee con la sesion de quien modera: la policy del muro admite a
 * admin y moderator sin mirar pertenencia ni is_hidden, asi que una
 * publicacion de una comunidad privada, o ya ocultada por
 * auto_hide_on_threshold, sale igual. Si no sale, es que la borraron: el
 * trigger publicacion_cierra_sus_reportes cierra sus reportes como resolved,
 * asi que ese hueco solo se ve entre el borrado y el siguiente render.
 */
export default async function CommunityPostsModerationPage() {
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
    .eq("target_type", "community_post")
    .in("status", ["pending", "reviewed"])
    .order("created_at", { ascending: false });

  const targetIds = (reports ?? []).map((r) => r.target_id);
  const { data: posts } = targetIds.length > 0
    ? await supabase
        .from("community_posts")
        .select(`
          id, cuerpo, community_id, author_id, parent_post_id, is_hidden, created_at,
          autor:profiles!author_id(nombre, user_id),
          comunidad:communities!community_id(nombre)
        `)
        .in("id", targetIds)
    : { data: [] };

  const postById = new Map((posts ?? []).map((p) => [p.id, p]));

  return (
    <div className="space-y-4 flex flex-col flex-1 h-full">
      <Link
        href="/admin/moderation"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Volver
      </Link>
      <h1 className="text-xl font-bold">Publicaciones de comunidad reportadas</h1>
      <p className="text-xs text-muted-foreground">
        A los 3 reportes activos la publicación se oculta sola. &ldquo;Restaurar&rdquo; deshace ese
        ocultamiento; &ldquo;Desestimar&rdquo; solo cierra el reporte.
      </p>

      {!reports || reports.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12 space-y-2">
          <p className="text-4xl">✅</p>
          <p className="font-medium">Sin publicaciones de comunidad reportadas pendientes</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((rep) => {
            const post = postById.get(rep.target_id);
            const autor = post && (Array.isArray(post.autor) ? post.autor[0] : post.autor);
            const comunidad =
              post && (Array.isArray(post.comunidad) ? post.comunidad[0] : post.comunidad);
            const reporter = Array.isArray(rep.reporter) ? rep.reporter[0] : rep.reporter;
            return (
              <div key={rep.id} className="rounded-lg border p-4 space-y-2 w-full">
                <div className="flex items-start justify-between gap-4">
                  <span className="text-xs text-muted-foreground flex-1 min-w-0 break-words">
                    Reportado por {reporter?.nombre ?? "?"} · {formatDate(rep.created_at)}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-warning/10 text-warning shrink-0 text-center">
                    {REPORT_REASON_LABELS[rep.reason as ReportReason] ?? rep.reason}
                  </span>
                </div>

                {rep.description && (
                  <p className="text-xs italic text-muted-foreground">&ldquo;{rep.description}&rdquo;</p>
                )}

                {post ? (
                  <div className="rounded-md bg-muted/40 p-3 space-y-1.5">
                    <p className="text-sm whitespace-pre-wrap break-words">{post.cuerpo}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <span className="truncate">Comunidad: {comunidad?.nombre ?? "?"}</span>
                        <Link
                          href={`/comunidades/${post.community_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground shrink-0"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                      </span>
                      <span className="hidden sm:inline">·</span>
                      <span className="truncate min-w-0">Autor: {autor?.nombre ?? "?"}</span>
                      <span className="hidden sm:inline">·</span>
                      <span>{formatDate(post.created_at)}</span>
                    </div>
                    <div className="flex gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${post.is_hidden ? "bg-danger/10 text-danger" : "bg-emerald-trust/10 text-emerald-trust"}`}
                      >
                        {post.is_hidden ? "Oculta" : "Visible"}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {post.parent_post_id ? "Comentario" : "Publicación"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Publicación no encontrada (borrada)</p>
                )}

                <ReportRowActions
                  reportId={rep.id}
                  targetType="community_post"
                  targetId={rep.target_id}
                  targetHidden={post?.is_hidden ?? false}
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
