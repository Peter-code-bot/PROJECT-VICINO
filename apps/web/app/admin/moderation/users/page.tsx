import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate, REPORT_REASON_LABELS, type ReportReason } from "@vicino/shared";
import { ReportRowActions } from "../report-row-actions";

export const metadata = { title: "Admin — Usuarios reportados" };

export default async function UsersModerationPage() {
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
    .eq("target_type", "user")
    .in("status", ["pending", "reviewed"])
    .order("created_at", { ascending: false });

  const targetIds = (reports ?? []).map((r) => r.target_id);
  const { data: profiles } = targetIds.length > 0
    ? await supabase
        .from("profiles")
        .select("id, nombre, user_id, foto, es_vendedor, nombre_negocio, is_hidden, trust_level, created_at")
        .in("id", targetIds)
    : { data: [] };

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (
    <div className="space-y-4">
      <Link
        href="/admin/moderation"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Volver
      </Link>
      <h1 className="text-xl font-bold">Usuarios reportados</h1>

      {!reports || reports.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">✅</p>
          <p className="font-medium">Sin usuarios reportados pendientes</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((rep) => {
            const profile = profileById.get(rep.target_id);
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

                {profile ? (
                  <div className="rounded-md bg-muted/40 p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {profile.nombre_negocio ?? profile.nombre}
                      </span>
                      {profile.user_id && (
                        <span className="text-xs text-muted-foreground">@{profile.user_id}</span>
                      )}
                      <Link
                        href={`/vendedor/${profile.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Trust: {profile.trust_level}</span>
                      <span>·</span>
                      <span>Miembro desde {formatDate(profile.created_at)}</span>
                    </div>
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full ${profile.is_hidden ? "bg-red-50 text-red-500" : "bg-green-50 text-green-600"}`}
                    >
                      {profile.is_hidden ? "Suspendido" : "Activo"}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Usuario no encontrado</p>
                )}

                <ReportRowActions
                  reportId={rep.id}
                  targetType="user"
                  targetId={rep.target_id}
                  targetHidden={profile?.is_hidden ?? false}
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
