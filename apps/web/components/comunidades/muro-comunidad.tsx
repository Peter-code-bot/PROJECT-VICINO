"use client";

import { useEffect, useRef } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { useInfiniteCursor } from "@/hooks/use-infinite-cursor";
import { cargarMuro, cargarMuroUnificado, publicarEnComunidad } from "@/app/(marketplace)/comunidades/actions";
import type { PostComunidad, CursorComunidad } from "@/lib/comunidades/tipos";
import { PostCard } from "./post-card";
import { PostComposer } from "./post-composer";

const PAGINA = 30;

interface MuroComunidadProps {
  /** null = muro unificado de mis comunidades (feed_comunidades_explorar). */
  communityId: string | null;
  communityNombre?: string;
  esPrivada?: boolean;
  initialPosts: PostComunidad[];
  initialCursor: CursorComunidad | null;
  currentUser: { id: string; nombre: string; foto: string | null } | null;
  /** Solo miembros publican; el mando local ademas borra lo ajeno. */
  puedoPublicar: boolean;
  puedoModerar?: boolean;
  vacio?: { titulo: string; texto: string };
}

export function cursorDeUltimo(posts: PostComunidad[], pagina: number = PAGINA): CursorComunidad | null {
  const ultimo = posts[posts.length - 1];
  return posts.length === pagina && ultimo ? { time: ultimo.created_at, id: ultimo.id } : null;
}

/**
 * Muro paginado por cursor (created_at, id) con carga al llegar abajo. El
 * composer va arriba, como en cualquier muro; publicar hace prependLive sin
 * tocar el cursor (la nueva publicacion es mas reciente que todo lo cargado).
 */
export function MuroComunidad({
  communityId,
  communityNombre,
  esPrivada = false,
  initialPosts,
  initialCursor,
  currentUser,
  puedoPublicar,
  puedoModerar = false,
  vacio,
}: MuroComunidadProps) {
  const {
    items: posts,
    isLoading,
    hasMore,
    error,
    loadMore,
    prependLive,
    removeItem,
    setItems,
  } = useInfiniteCursor<PostComunidad, CursorComunidad>({
    action: async ({ cursor, limit }) =>
      communityId
        ? cargarMuro({ community_id: communityId, cursor, limit })
        : cargarMuroUnificado({ cursor, limit }),
    initialItems: initialPosts,
    initialCursor,
    limit: PAGINA,
  });

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "400px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMore]);

  async function publicar(texto: string): Promise<string | null> {
    if (!communityId || !currentUser) return "Inicia sesión para publicar.";
    const r = await publicarEnComunidad({ community_id: communityId, texto });
    if ("error" in r) return r.error;
    // La fila optimista se arma con lo que devuelve la RPC (id, created_at) y
    // lo que ya se sabe del autor. Al recargar llega la autoritativa.
    prependLive({
      id: r.data.id,
      community_id: communityId,
      community_nombre: communityNombre ?? "",
      community_es_privada: esPrivada,
      author_id: currentUser.id,
      author_nombre: currentUser.nombre,
      author_foto: currentUser.foto ?? "",
      author_trust_level: "",
      cuerpo: texto,
      created_at: r.data.created_at,
      likes_count: 0,
      comentarios_count: 0,
      le_di_like: false,
    });
    return null;
  }

  return (
    <div className="space-y-3">
      {puedoPublicar && communityId && currentUser && (
        <PostComposer
          placeholder={`Comparte algo con ${communityNombre ?? "la comunidad"}`}
          onEnviar={publicar}
          autor={{ nombre: currentUser.nombre, foto: currentUser.foto }}
        />
      )}

      {posts.length === 0 && !isLoading && (
        <div className="py-14 text-center">
          <div className="mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--sidebar-bg)]">
            <MessageSquare className="h-7 w-7 text-[color:var(--fg-muted)]" />
          </div>
          <p className="text-sm font-medium text-[color:var(--fg)]">{vacio?.titulo ?? "Todavía no hay publicaciones"}</p>
          <p className="mt-1 text-xs text-[color:var(--fg-muted)]">
            {vacio?.texto ?? (puedoPublicar ? "Sé quien rompa el hielo." : "Únete para ser quien rompa el hielo.")}
          </p>
        </div>
      )}

      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          currentUserId={currentUser?.id ?? null}
          puedoModerar={puedoModerar}
          conComunidad={communityId === null}
          onBorrada={(id) => removeItem((p) => p.id === id)}
          onCambio={(fresco) => setItems((prev) => prev.map((p) => (p.id === fresco.id ? fresco : p)))}
        />
      ))}

      <div ref={sentinelRef} aria-hidden="true" className="h-px" />

      {isLoading && (
        <div className="flex justify-center py-4" role="status" aria-live="polite">
          <Loader2 className="h-5 w-5 animate-spin text-[color:var(--fg-muted)]" />
          <span className="sr-only">Cargando más publicaciones</span>
        </div>
      )}
      {error && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <p className="text-xs text-[color:var(--fg-muted)]">{error}</p>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="text-xs font-semibold text-[color:var(--brand-hi)] hover:underline"
          >
            Reintentar
          </button>
        </div>
      )}
      {!hasMore && posts.length > 0 && (
        <p className="py-6 text-center text-xs text-[color:var(--fg-dim)]">Estás al día</p>
      )}
    </div>
  );
}
