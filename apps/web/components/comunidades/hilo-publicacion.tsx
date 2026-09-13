"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Lock, Trash2 } from "lucide-react";
import { formatRelativeTime } from "@vicino/shared";
import { useInfiniteCursor } from "@/hooks/use-infinite-cursor";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cargarComentarios, comentarPublicacion, eliminarPublicacion } from "@/app/(marketplace)/comunidades/actions";
import type { PostComunidad, ComentarioComunidad, CursorComunidad } from "@/lib/comunidades/tipos";
import { PostCard } from "./post-card";
import { PostComposer } from "./post-composer";
import { ConfirmarDialog } from "./confirmar-dialog";

const PAGINA = 30;

interface HiloPublicacionProps {
  post: PostComunidad;
  comentarios: ComentarioComunidad[];
  cursor: CursorComunidad | null;
  currentUser: { id: string; nombre: string; foto: string | null };
  puedoComentar: boolean;
  puedoModerar: boolean;
}

/**
 * Hilo de una publicacion: la publicacion arriba (misma tarjeta del muro,
 * sin recortar), los comentarios en orden ASCENDENTE con cursor `>` y el
 * composer abajo, pegado como en el chat (chat-window es el molde).
 *
 * Es una RUTA real y no un sheet: la notificacion "comentario en tu
 * publicacion" tiene que abrir el hilo directamente (decision 11), y un
 * sheet obligaria a cargar primero el muro entero y luego abrirse desde un
 * parametro. La ruta ademas se comparte, tiene loading.tsx propio y el
 * boton atras del sistema hace lo que se espera.
 */
export function HiloPublicacion({
  post,
  comentarios: iniciales,
  cursor,
  currentUser,
  puedoComentar,
  puedoModerar,
}: HiloPublicacionProps) {
  const router = useRouter();
  const [cabecera, setCabecera] = useState<PostComunidad>(post);
  const [aBorrar, setABorrar] = useState<ComentarioComunidad | null>(null);
  const [borrando, setBorrando] = useState(false);

  const {
    items: comentarios,
    isLoading,
    hasMore,
    error,
    loadMore,
    appendLive,
    removeItem,
  } = useInfiniteCursor<ComentarioComunidad, CursorComunidad>({
    action: ({ cursor: c, limit }) => cargarComentarios({ post_id: post.id, cursor: c, limit }),
    initialItems: iniciales,
    initialCursor: cursor,
    limit: PAGINA,
  });

  async function comentar(texto: string): Promise<string | null> {
    const r = await comentarPublicacion({ community_id: post.community_id, parent_post_id: post.id, texto });
    if ("error" in r) return r.error;
    appendLive({
      id: r.data.id,
      author_id: currentUser.id,
      author_nombre: currentUser.nombre,
      author_foto: currentUser.foto ?? "",
      cuerpo: texto,
      created_at: r.data.created_at,
      puedo_borrar: true,
    });
    setCabecera((prev) => ({ ...prev, comentarios_count: prev.comentarios_count + 1 }));
    return null;
  }

  async function borrarComentario() {
    if (!aBorrar) return;
    setBorrando(true);
    const r = await eliminarPublicacion(aBorrar.id);
    setBorrando(false);
    if ("error" in r) {
      toast.error(r.error);
      return;
    }
    removeItem((c) => c.id === aBorrar.id);
    setCabecera((prev) => ({ ...prev, comentarios_count: Math.max(0, prev.comentarios_count - 1) }));
    setABorrar(null);
    toast.success("Comentario borrado");
  }

  return (
    // El padding inferior reserva el hueco del composer fijo + la barra
    // inferior en movil; en escritorio solo el del composer.
    <div className="mx-auto flex w-full max-w-lg flex-col pb-[calc(env(safe-area-inset-bottom)+10rem)] md:pb-24">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Volver"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--brand-hi)]">Publicación</p>
          <Link href={`/comunidades/${post.community_id}`} className="flex items-center gap-1 truncate font-heading text-[15px] font-bold text-[color:var(--fg)] hover:underline">
            {post.community_es_privada && <Lock className="h-3.5 w-3.5 shrink-0" />}
            {post.community_nombre}
          </Link>
        </div>
      </div>

      <div className="px-4">
        <PostCard
          post={cabecera}
          currentUserId={currentUser.id}
          puedoModerar={puedoModerar}
          esCabeceraDeHilo
          onCambio={setCabecera}
          onBorrada={() => {
            router.replace(`/comunidades/${post.community_id}`);
          }}
        />
      </div>

      <section className="mt-4 px-4" aria-label="Comentarios">
        {comentarios.length === 0 && !isLoading && (
          <p className="py-8 text-center text-sm text-[color:var(--fg-muted)]">
            {puedoComentar ? "Nadie ha comentado todavía. Sé la primera persona." : "Nadie ha comentado todavía."}
          </p>
        )}
        <ul className="space-y-3">
          {comentarios.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Link href={`/vendedor/${c.author_id}`} aria-label={c.author_nombre} className="shrink-0 pt-0.5">
                <UserAvatar src={c.author_foto} name={c.author_nombre} size="sm" />
              </Link>
              <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-[color:var(--sidebar-bg)] px-3.5 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/vendedor/${c.author_id}`} className="truncate text-[13px] font-semibold text-[color:var(--fg)]">
                    {c.author_nombre}
                  </Link>
                  <time dateTime={c.created_at} className="shrink-0 text-[11px] text-[color:var(--fg-dim)]">
                    {formatRelativeTime(c.created_at)}
                  </time>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[color:var(--fg)]">{c.cuerpo}</p>
                {(c.puedo_borrar || puedoModerar) && (
                  <button
                    type="button"
                    onClick={() => setABorrar(c)}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--fg-muted)] hover:text-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                    Borrar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        {hasMore && (
          <div className="flex justify-center py-4">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={isLoading}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-[color:var(--card-2)] px-4 text-[13px] font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] disabled:opacity-60"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Cargar más comentarios
            </button>
          </div>
        )}
        {error && (
          <p className="py-3 text-center text-xs text-[color:var(--fg-muted)]">
            {error}{" "}
            <button type="button" onClick={() => void loadMore()} className="font-semibold text-[color:var(--brand-hi)] hover:underline">
              Reintentar
            </button>
          </p>
        )}
      </section>

      {puedoComentar ? (
        // En movil el composer va justo encima de la barra inferior (misma
        // altura que el FAB de solicitudes); en escritorio la barra no existe
        // y el sidebar ocupa 16 rem a la izquierda.
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-30 px-4 py-2 md:bottom-0 md:left-64 md:border-t md:border-[color:var(--border)]/15 md:bg-[color:var(--bg)]/95 md:py-3 md:backdrop-blur">
          <div className="mx-auto max-w-lg">
            <PostComposer placeholder="Escribe un comentario" onEnviar={comentar} compacto etiquetaBoton="Comentar" />
          </div>
        </div>
      ) : (
        <p className="px-4 pt-6 text-center text-xs text-[color:var(--fg-muted)]">
          Únete a la comunidad para comentar.
        </p>
      )}

      <ConfirmarDialog
        open={aBorrar !== null}
        onOpenChange={(v) => (!v && !borrando ? setABorrar(null) : undefined)}
        titulo="Borrar comentario"
        cuerpo="Este comentario desaparecerá del hilo. No se puede deshacer."
        confirmar="Borrar"
        peligroso
        pendiente={borrando}
        onConfirmar={() => void borrarComentario()}
      />
    </div>
  );
}
