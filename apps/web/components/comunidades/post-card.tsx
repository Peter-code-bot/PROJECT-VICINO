"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Heart, MessageCircle, MoreVertical, Flag, Trash2, Lock } from "lucide-react";
import { formatRelativeTime, TRUST_LEVELS, type TrustLevel } from "@vicino/shared";
import { cn } from "@/lib/utils";
import { hapticLight } from "@/lib/haptics";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { UserAvatar } from "@/components/ui/user-avatar";
import { SellerBadge } from "@/components/shared/seller-badge";
import { ReportModal } from "@/components/moderation/report-modal";
import { alternarLike, eliminarPublicacion } from "@/app/(marketplace)/comunidades/actions";
import type { PostComunidad } from "@/lib/comunidades/tipos";
import { ConfirmarDialog } from "./confirmar-dialog";

function esTrustLevel(v: string | null | undefined): v is TrustLevel {
  return typeof v === "string" && v in TRUST_LEVELS;
}

/** Copy exacto de la decision 11. No se toca. */
export const COPY_BORRAR_PUBLICACION =
  "Si borras esta publicación se borran también los comentarios que otras personas escribieron en ella. No se puede deshacer.";

interface PostCardProps {
  post: PostComunidad;
  /** Sesion actual, para saber si es propia. */
  currentUserId: string | null;
  /** true si el mando local (owner/moderador) puede borrarla aunque no sea suya. */
  puedoModerar?: boolean;
  /** Muestra el nombre de la comunidad (muro unificado). */
  conComunidad?: boolean;
  /** Si es la cabecera del hilo, el cuerpo no se recorta y no enlaza a si misma. */
  esCabeceraDeHilo?: boolean;
  onBorrada?: (postId: string) => void;
  /** Reacciones y comentarios actualizados (para que el padre refleje conteos). */
  onCambio?: (post: PostComunidad) => void;
}

export function PostCard({
  post,
  currentUserId,
  puedoModerar = false,
  conComunidad = false,
  esCabeceraDeHilo = false,
  onBorrada,
  onCambio,
}: PostCardProps) {
  const [local, setLocal] = useState<PostComunidad>(post);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [reportar, setReportar] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resincronizar con la fila fresca del padre
    setLocal(post);
  }, [post]);

  useEffect(() => {
    if (!menuAbierto) return;
    function fuera(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAbierto(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [menuAbierto]);

  function aplicar(siguiente: PostComunidad) {
    setLocal(siguiente);
    onCambio?.(siguiente);
  }

  const like = useOptimisticMutation(() => alternarLike(local.id), {
    onMutate: () => {
      const previo = local;
      aplicar({
        ...previo,
        le_di_like: !previo.le_di_like,
        likes_count: Math.max(0, previo.likes_count + (previo.le_di_like ? -1 : 1)),
      });
      return () => aplicar(previo);
    },
    onSuccess: (r) => {
      if ("data" in r) aplicar({ ...local, le_di_like: r.data.le_di_like, likes_count: r.data.likes_count });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo reaccionar"),
  });

  const borrar = useOptimisticMutation(() => eliminarPublicacion(local.id), {
    onSuccess: (r) => {
      setConfirmarBorrar(false);
      if ("data" in r && r.data.borrado) {
        toast.success("Publicación borrada");
        onBorrada?.(local.id);
      } else {
        // Idempotente: ya no existia. Se quita igual de la lista.
        onBorrada?.(local.id);
      }
    },
    onError: (err) => {
      setConfirmarBorrar(false);
      toast.error(err instanceof Error ? err.message : "No se pudo borrar");
    },
  });

  const esPropia = currentUserId !== null && currentUserId === local.author_id;
  const puedoBorrar = esPropia || puedoModerar;
  const hrefHilo = `/comunidades/${local.community_id}/publicacion/${local.id}`;
  const cuerpo = esCabeceraDeHilo ? (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[color:var(--fg)]">{local.cuerpo}</p>
  ) : (
    <Link href={hrefHilo} className="block">
      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[color:var(--fg)] line-clamp-6">
        {local.cuerpo}
      </p>
    </Link>
  );

  return (
    <article className="rounded-2xl bg-[color:var(--sidebar-bg)] p-4">
      <div className="flex items-start gap-3">
        <Link href={`/vendedor/${local.author_id}`} aria-label={local.author_nombre}>
          <UserAvatar src={local.author_foto} name={local.author_nombre} size="md" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={`/vendedor/${local.author_id}`} className="truncate text-sm font-semibold text-[color:var(--fg)]">
              {local.author_nombre}
            </Link>
            {esTrustLevel(local.author_trust_level) && (
              <SellerBadge level={local.author_trust_level} size="sm" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-[color:var(--fg-muted)]">
            {conComunidad && (
              <>
                <Link href={`/comunidades/${local.community_id}`} className="inline-flex items-center gap-1 font-medium text-[color:var(--brand-hi)] hover:underline">
                  {local.community_es_privada && <Lock className="h-3 w-3" />}
                  {local.community_nombre}
                </Link>
                <span>·</span>
              </>
            )}
            <time dateTime={local.created_at}>{formatRelativeTime(local.created_at)}</time>
          </div>
        </div>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuAbierto((v) => !v)}
            aria-label="Más opciones"
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
            className="-mr-1.5 -mt-1 rounded-full p-1.5 text-[color:var(--fg-muted)] transition-colors hover:bg-[color:var(--card)] hover:text-[color:var(--fg)]"
          >
            <MoreVertical size={18} aria-hidden="true" />
          </button>
          {menuAbierto && (
            <div role="menu" className="absolute right-0 top-full z-50 mt-1 min-w-[190px] overflow-hidden rounded-xl border border-border bg-card shadow-lg">
              {!esPropia && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuAbierto(false);
                    setReportar(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                >
                  <Flag size={14} aria-hidden="true" />
                  Reportar publicación
                </button>
              )}
              {puedoBorrar && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuAbierto(false);
                    setConfirmarBorrar(true);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400",
                    !esPropia && "border-t border-border/60",
                  )}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Borrar publicación
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">{cuerpo}</div>

      <div className="mt-3 flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            void hapticLight();
            void like.mutate(undefined);
          }}
          aria-pressed={local.le_di_like}
          aria-label={local.le_di_like ? "Quitar me gusta" : "Me gusta"}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-all active:scale-95",
            local.le_di_like
              ? "bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)]"
              : "text-[color:var(--fg-muted)] hover:bg-[color:var(--card)] hover:text-[color:var(--fg)]",
          )}
        >
          <Heart className={cn("h-4 w-4", local.le_di_like && "fill-current")} />
          {local.likes_count > 0 ? local.likes_count : ""}
        </button>
        {esCabeceraDeHilo ? (
          <span className="inline-flex h-9 items-center gap-1.5 px-3 text-[13px] font-semibold text-[color:var(--fg-muted)]">
            <MessageCircle className="h-4 w-4" />
            {local.comentarios_count} {local.comentarios_count === 1 ? "comentario" : "comentarios"}
          </span>
        ) : (
          <Link
            href={hrefHilo}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-[color:var(--fg-muted)] transition-colors hover:bg-[color:var(--card)] hover:text-[color:var(--fg)]"
          >
            <MessageCircle className="h-4 w-4" />
            {local.comentarios_count > 0 ? local.comentarios_count : "Comentar"}
          </Link>
        )}
      </div>

      <ReportModal
        open={reportar}
        onClose={() => setReportar(false)}
        targetType="community_post"
        targetId={local.id}
        targetLabel={local.cuerpo.slice(0, 60)}
      />
      <ConfirmarDialog
        open={confirmarBorrar}
        onOpenChange={setConfirmarBorrar}
        titulo="Borrar publicación"
        cuerpo={COPY_BORRAR_PUBLICACION}
        confirmar="Borrar"
        peligroso
        pendiente={borrar.isPending}
        onConfirmar={() => void borrar.mutate(undefined)}
      />
    </article>
  );
}
