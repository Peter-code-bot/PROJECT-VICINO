import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Star, ShoppingBag, User, MessageSquare, AlertOctagon, Users } from "lucide-react";
import type { ReportTargetType } from "@vicino/shared";

export const metadata = { title: "Admin — Moderación" };

export default async function ModerationIndexPage() {
  const supabase = await createClient();

  // Conteos de pending por target_type
  const { data: pendingRows } = await supabase
    .from("reports")
    .select("target_type")
    .eq("status", "pending");

  // Claves fijas tipadas contra el enum compartido: un target_type nuevo sin su
  // card aqui es un error de type-check, no un reporte que nadie ve.
  const counts: Record<ReportTargetType, number> = {
    listing: 0,
    user: 0,
    message: 0,
    review: 0,
    community_post: 0,
  };
  (pendingRows ?? []).forEach((r) => {
    const key = r.target_type as ReportTargetType;
    if (key in counts) counts[key] += 1;
  });

  // Conteo de critical_reports pendientes de denuncia
  const { count: criticalCount } = await supabase
    .from("critical_reports")
    .select("id", { count: "exact", head: true })
    .is("authority_notified_at", null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Moderación</h1>
        <p className="text-sm text-muted-foreground">
          Reportes pendientes de revisión. SLA: 48 horas hábiles.
        </p>
      </div>

      {/* Critical / CSAM banner */}
      {(criticalCount ?? 0) > 0 && (
        <Link
          href="/admin/moderation/critical"
          className="block rounded-2xl border border-red-500/40 bg-red-500/5 p-4 hover:bg-red-500/10 transition-colors"
        >
          <div className="flex items-center gap-3">
            <AlertOctagon className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-sm text-red-700 dark:text-red-300">
                {criticalCount} reporte{criticalCount === 1 ? "" : "s"} crítico{criticalCount === 1 ? "" : "s"} pendiente{criticalCount === 1 ? "" : "s"} de denuncia
              </p>
              <p className="text-xs text-red-600/80 dark:text-red-400/80">
                Acción legal requerida — revisar y registrar denuncia ante autoridad
              </p>
            </div>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ModerationCard
          href="/admin/moderation/listings"
          label="Productos reportados"
          icon={<ShoppingBag className="w-5 h-5" />}
          count={counts.listing ?? 0}
        />
        <ModerationCard
          href="/admin/moderation/users"
          label="Usuarios reportados"
          icon={<User className="w-5 h-5" />}
          count={counts.user ?? 0}
        />
        <ModerationCard
          href="/admin/moderation/messages"
          label="Mensajes reportados"
          icon={<MessageSquare className="w-5 h-5" />}
          count={counts.message ?? 0}
        />
        <ModerationCard
          href="/admin/moderation/reviews"
          label="Reseñas reportadas"
          icon={<Star className="w-5 h-5" />}
          count={counts.review ?? 0}
        />
        <ModerationCard
          href="/admin/moderation/community-posts"
          label="Publicaciones de comunidad reportadas"
          icon={<Users className="w-5 h-5" />}
          count={counts.community_post ?? 0}
        />
      </div>
    </div>
  );
}

function ModerationCard({
  href,
  label,
  icon,
  count,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  count: number;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-border/40 bg-background hover:bg-muted/40 p-4 transition-colors"
    >
      <div className="text-muted-foreground">{icon}</div>
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {count === 0 ? "Sin pendientes" : `${count} pendiente${count === 1 ? "" : "s"}`}
        </p>
      </div>
      {count > 0 && (
        <span className="rounded-full bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-0.5 text-xs font-semibold">
          {count}
        </span>
      )}
    </Link>
  );
}
